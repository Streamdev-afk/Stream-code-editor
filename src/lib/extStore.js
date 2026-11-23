// Extensions store: ready-made MCP servers you can add in one click.
// All of these are remote (https) servers. Some need a free key from the provider.
export const STORE = [
  { id: 'deepwiki', name: 'DeepWiki', tag: 'Code', color: '#4f8cff', url: 'https://mcp.deepwiki.com/mcp',
    desc: 'Ask questions about any public GitHub repo: its structure, docs and how it works.' },
  { id: 'msdocs', name: 'Microsoft Learn', tag: 'Docs', color: '#2fa84f', url: 'https://learn.microsoft.com/api/mcp',
    desc: 'Search official Microsoft and Azure documentation and code samples.' },
  { id: 'cfdocs', name: 'Cloudflare Docs', tag: 'Docs', color: '#f38020', url: 'https://docs.mcp.cloudflare.com/mcp',
    desc: 'Up to date Cloudflare docs: Workers, Pages, R2, D1 and more.' },
  { id: 'context7', name: 'Context7', tag: 'Docs', color: '#8b5cf6', url: 'https://mcp.context7.com/mcp',
    desc: 'Current documentation and code examples for thousands of libraries.',
    fields: [{ label: 'API key (optional, raises limits)', header: 'CONTEXT7_API_KEY', optional: true }] },
  { id: 'hf', name: 'Hugging Face', tag: 'AI', color: '#f5b400', url: 'https://huggingface.co/mcp',
    desc: 'Search models, datasets and papers on the Hugging Face Hub.',
    fields: [{ label: 'Access token (optional)', header: 'Authorization', prefix: 'Bearer ', optional: true }] },
  { id: 'gitmcp', name: 'GitMCP', tag: 'Code', color: '#e5484d', template: 'https://gitmcp.io/{owner}/{repo}',
    desc: 'Turn any GitHub repo into a docs source for the AI.',
    inputs: [{ key: 'owner', label: 'GitHub owner (e.g. facebook)' }, { key: 'repo', label: 'Repository (e.g. react)' }] },
]
