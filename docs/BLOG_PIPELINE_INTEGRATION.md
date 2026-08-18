# Blog Pipeline Integration

MDTeX integrates with the separate `blog-pipeline` project through a CLI interface.

## Responsibilities

### MDTeX owns
- Article authoring and organization
- Markdown/LaTeX source editing
- Platform-specific rendering (WeChat, Zhihu)
- PDF compilation
- Asset management
- AI-assisted editing
- Local preview

### blog-pipeline owns
- Multi-repository orchestration
- GitHub synchronization
- Release creation
- Production deployment (SSH/rsync)
- Health checks and verification
- Rollback

## Integration Point

MDTeX detects the `blogpipe` CLI and delegates publication:

```js
const bp = new BlogPipelineIntegration();
const status = bp.detect();

if (status.available) {
  await bp.publish(article, {
    htmlPath: 'dist/article.html',
    pdfPath: 'dist/article.pdf',
  });
}
```

## CLI

```bash
# Check if blog pipeline is available
publisher blogpipe status

# Publish an article via blog pipeline
publisher blogpipe publish <article-id>
```

## Data Flow

```
MDTeX article
    │
    ├── source.md / main.tex
    ├── article.json (metadata)
    ├── assets/ (images)
    ├── dist/article.wechat.html
    └── dist/article.pdf
         │
         ▼
    blogpipe publish
         │
         ├── GitHub repository sync
         ├── Release creation
         ├── Production build
         └── Deployment
```

## Configuration

Blog pipeline path can be configured in `~/.config/publisher/config.json`:

```json
{
  "blogpipe_cli": "blogpipe"
}
```

The integration auto-detects `blogpipe`, `blog-pipeline`, or `bp` in PATH.
