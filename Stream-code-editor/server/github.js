/**
 * GitHub API wrapper.
 * Uses the user's Personal Access Token (PAT) for all calls.
 */

const GITHUB_API = 'https://api.github.com'

/**
 * Make an authenticated request to the GitHub API.
 */
async function ghFetch(path, token, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Stream-Editor',
      ...(options.headers || {}),
    },
  })

  // 204 no content
  if (res.status === 204) return null

  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text } }

  if (!res.ok) {
    const msg = data?.message || `HTTP ${res.status}`
    const err = new Error(`GitHub: ${msg}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

/**
 * Get the authenticated user's profile.
 */
export async function getUser(token) {
  return ghFetch('/user', token)
}

/**
 * Check if a repo exists for the user.
 */
export async function repoExists(token, owner, repo) {
  try {
    await ghFetch(`/repos/${owner}/${repo}`, token)
    return true
  } catch (err) {
    if (err.status === 404) return false
    throw err
  }
}

/**
 * Create a repo for the user.
 */
export async function createRepo(token, name, { isPrivate = true, description = '' } = {}) {
  return ghFetch('/user/repos', token, {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: false,
    }),
  })
}

/**
 * Get the default branch of a repo.
 */
export async function getDefaultBranch(token, owner, repo) {
  const data = await ghFetch(`/repos/${owner}/${repo}`, token)
  return data.default_branch || 'main'
}

/**
 * Get the current tree of a repo (all files, recursively).
 * Returns [{ path, sha, type }, ...]
 */
export async function getTree(token, owner, repo, ref) {
  const data = await ghFetch(`/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, token)
  return (data.tree || []).filter((t) => t.type === 'blob')
}

/**
 * Get the SHA of a specific file.
 */
export async function getFileSha(token, owner, repo, path, ref) {
  try {
    const data = await ghFetch(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, token)
    return data.sha
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

/**
 * Get file contents (returns decoded text).
 */
export async function getFileContent(token, owner, repo, path, ref) {
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, token)
  if (!data.content) return null
  // GitHub returns base64 content with linebreaks
  const cleaned = data.content.replace(/\n/g, '')
  return Buffer.from(cleaned, 'base64').toString('utf8')
}

/**
 * Push one file (create or update).
 * Returns the commit SHA on success.
 */
export async function pushFile(token, owner, repo, branch, path, content, message = 'Update via Stream') {
  const sha = await getFileSha(token, owner, repo, path, branch)
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
  }
  if (sha) body.sha = sha

  const data = await ghFetch(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    token,
    { method: 'PUT', body: JSON.stringify(body) }
  )
  return data.commit?.sha || data.content?.sha
}

/**
 * Get the initial commit SHA of an empty repo (needed for the first push).
 * If the repo is truly empty, we get null and use the base tree endpoint.
 */
async function getHeadCommit(token, owner, repo, branch) {
  try {
    const data = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token)
    return data.object.sha
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

/**
 * Create or update a branch ref to point at a commit SHA.
 */
async function setRef(token, owner, repo, branch, sha) {
  try {
    await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ sha, force: false }),
    })
  } catch (err) {
    if (err.status === 422 || err.status === 404) {
      // ref doesn't exist, create it
      await ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      })
    } else {
      throw err
    }
  }
}

/**
 * Push multiple files in a single commit.
 * This is the atomic, efficient way — one commit for N files.
 */
export async function pushFiles(token, owner, repo, branch, files, message = 'Update via Stream') {
  // files: [{ path, content }, ...]

  // Get the current HEAD
  const headSha = await getHeadCommit(token, owner, repo, branch)

  // Build blobs
  const blobs = []
  for (const file of files) {
    const blob = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
      method: 'POST',
      body: JSON.stringify({
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      }),
    })
    blobs.push({ path: file.path, sha: blob.sha })
  }

  // Build tree entries
  const treeEntries = blobs.map((b) => ({
    path: b.path,
    mode: '100644',
    type: 'blob',
    sha: b.sha,
  }))

  // Create tree (base_tree = current head tree to keep existing files we didn't touch)
  const treeBody = { tree: treeEntries }
  if (headSha) treeBody.base_tree = headSha
  const tree = await ghFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify(treeBody),
  })

  // Create commit
  const commitBody = {
    message,
    tree: tree.sha,
    parents: headSha ? [headSha] : [],
  }
  const commit = await ghFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify(commitBody),
  })

  // Update the ref
  await setRef(token, owner, repo, branch, commit.sha)

  return commit.sha
}