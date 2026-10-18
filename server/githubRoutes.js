import express from 'express'
import { encrypt, decrypt, isCryptoConfigured } from './crypto.js'
import {
  getUser,
  repoExists,
  createRepo,
  getDefaultBranch,
  getTree,
  getFileContent,
  pushFiles,
} from './github.js'

// Simple in-memory token store. In production, save to Supabase.
// For now this works per-process; restart = tokens lost (users re-paste).
const userTokens = new Map() // userId -> encrypted token

export default function createGithubRouter({ supabaseAdmin }) {
  const router = express.Router()

  // Middleware: require auth
  const requireAuth = (req, res, next) => {
    if (!req.isAuth || !req.user?.id) {
      return res.status(401).json({ error: 'Sign in required' })
    }
    next()
  }

  async function loadToken(userId) {
    // Check in-memory first
    if (userTokens.has(userId)) {
      return decrypt(userTokens.get(userId))
    }
    // Fall back to Supabase
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from('github_tokens')
        .select('encrypted_token')
        .eq('user_id', userId)
        .maybeSingle()
      if (data?.encrypted_token) {
        userTokens.set(userId, data.encrypted_token)
        return decrypt(data.encrypted_token)
      }
    }
    return null
  }

  async function saveToken(userId, token) {
    if (!isCryptoConfigured()) {
      throw new Error('Server-side encryption not configured. Cannot save tokens.')
    }
    const enc = encrypt(token)
    userTokens.set(userId, enc)
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('github_tokens')
        .upsert(
          { user_id: userId, encrypted_token: enc, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        )
    }
  }

  async function deleteToken(userId) {
    userTokens.delete(userId)
    if (supabaseAdmin) {
      await supabaseAdmin.from('github_tokens').delete().eq('user_id', userId)
    }
  }

  // ---- Validate + save a PAT ----
  router.post('/connect', requireAuth, async (req, res) => {
    const { token } = req.body
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token required' })
    }
    try {
      const user = await getUser(token.trim())
      await saveToken(req.user.id, token.trim())
      res.json({
        ok: true,
        login: user.login,
        name: user.name,
        avatar: user.avatar_url,
        tokenType: token.startsWith('github_pat_') ? 'fine-grained' : 'classic',
      })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  // ---- Check connection status ----
  router.get('/status', requireAuth, async (req, res) => {
    try {
      const token = await loadToken(req.user.id)
      if (!token) return res.json({ connected: false })
      const user = await getUser(token)
      res.json({
        connected: true,
        login: user.login,
        name: user.name,
        avatar: user.avatar_url,
      })
    } catch (err) {
      // Token likely invalid/revoked
      await deleteToken(req.user.id)
      res.json({ connected: false, error: err.message })
    }
  })

  // ---- Disconnect ----
  router.post('/disconnect', requireAuth, async (req, res) => {
    await deleteToken(req.user.id)
    res.json({ ok: true })
  })

  // ---- Push a session's files ----
  router.post('/push', requireAuth, async (req, res) => {
    const { repoName, isPrivate = true, files, sessionTitle } = req.body
    if (!repoName || typeof repoName !== 'string') {
      return res.status(400).json({ error: 'repoName required' })
    }
    if (!files || typeof files !== 'object') {
      return res.status(400).json({ error: 'files required' })
    }

    try {
      const token = await loadToken(req.user.id)
      if (!token) return res.status(400).json({ error: 'GitHub not connected' })

      const user = await getUser(token)
      const owner = user.login
      const safeRepo = repoName.replace(/[^a-zA-Z0-9._-]/g, '-')

      // Create repo if needed
      const exists = await repoExists(token, owner, safeRepo)
      if (!exists) {
        await createRepo(token, safeRepo, {
          isPrivate,
          description: sessionTitle || `Project from Stream`,
        })
        // GitHub needs a moment after repo creation
        await new Promise((r) => setTimeout(r, 1000))
      }

      const branch = await getDefaultBranch(token, owner, safeRepo)

      // Build file list
      const fileList = Object.entries(files)
        .filter(([p]) => !p.endsWith('.gitkeep'))
        .map(([path, f]) => ({ path, content: f.content || '' }))

      if (fileList.length === 0) {
        return res.status(400).json({ error: 'No files to push' })
      }

      const commitSha = await pushFiles(
        token,
        owner,
        safeRepo,
        branch,
        fileList,
        `Stream: ${sessionTitle || 'Update'}`
      )

      res.json({
        ok: true,
        owner,
        repo: safeRepo,
        branch,
        commit: commitSha,
        url: `https://github.com/${owner}/${safeRepo}`,
        fileCount: fileList.length,
      })
    } catch (err) {
      console.error('Push error:', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ---- List user's repos (for the picker) ----
  router.get('/repos', requireAuth, async (req, res) => {
    try {
      const token = await loadToken(req.user.id)
      if (!token) return res.status(400).json({ error: 'GitHub not connected' })

      const res2 = await fetch('https://api.github.com/user/repos?sort=updated&per_page=50', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Stream-Editor',
        },
      })
      if (!res2.ok) throw new Error(`GitHub HTTP ${res2.status}`)
      const repos = await res2.json()
      res.json({
        repos: repos.map((r) => ({
          name: r.name,
          fullName: r.full_name,
          private: r.private,
          updatedAt: r.updated_at,
        })),
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ---- Pull files from a repo ----
  router.post('/pull', requireAuth, async (req, res) => {
    const { owner, repo, branch } = req.body
    if (!owner || !repo) {
      return res.status(400).json({ error: 'owner and repo required' })
    }

    try {
      const token = await loadToken(req.user.id)
      if (!token) return res.status(400).json({ error: 'GitHub not connected' })

      const branchName = branch || (await getDefaultBranch(token, owner, repo))
      const tree = await getTree(token, owner, repo, branchName)

      // Limit to a reasonable number and skip junk
      const fileEntries = tree
        .filter((t) => {
          if (t.path.startsWith('.github/')) return false
          if (t.path === '.gitignore') return true
          if (t.path.includes('/node_modules/')) return false
          if (t.path.startsWith('node_modules/')) return false
          return true
        })
        .slice(0, 200)

      const files = {}
      for (const entry of fileEntries) {
        try {
          const content = await getFileContent(token, owner, repo, entry.path, branchName)
          if (content !== null) {
            files[entry.path] = { content }
          }
        } catch (e) {
          // Skip files that fail (binary, too large, etc)
        }
      }

      res.json({
        ok: true,
        owner,
        repo,
        branch: branchName,
        fileCount: Object.keys(files).length,
        files,
      })
    } catch (err) {
      console.error('Pull error:', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}