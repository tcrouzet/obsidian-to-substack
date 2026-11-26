# To Substack

Publish an Obsidian note as a newsletter article or a Substack Note. Your local file stays unchanged.

## Install and connect

1. In **Settings → Community plugins → Browse**, install and enable **To Substack**.
2. Open **Settings → To Substack → Sign in**.
3. Complete the Substack login in the window that opens. Your newsletters appear once connected.

Requires Obsidian 1.14 or later. The interface supports English and French.

## Publish

Right-click a Markdown file and choose **To Substack**:

- **Newsletter → Create draft**: creates a draft. Choose a category if offered; it is saved automatically. Then **Open draft in Substack**, **Close** to keep the draft, or **Publish** to publish and email subscribers.
- **Note → Publish note**: publishes immediately to your Substack Notes feed.

To publish an excerpt, select text and use the editor's context menu. Only **Note** is offered; the file's YAML is ignored.

## Newsletter article: complete YAML example

Put the YAML between `---` lines at the very top of your file. All four properties are optional. Replace the image path with one in your vault, or use an image URL.

```markdown
---
title: "A walk by the river"
metadescription: "Notes from an autumn morning."
image: "Photos/river.jpg"
caption: "Morning light on the river."
---

The river was quiet. **The light changed everything.**

## Along the bank

The rest of the article goes here.
```

This creates an article titled **A walk by the river**, with **Notes from an autumn morning.** as its subtitle. The photograph and its caption appear before the body text. The YAML itself is not published.

| YAML property | Newsletter article | Substack Note |
| --- | --- | --- |
| `title` | Article title | Bold text at the top |
| `metadescription` | Subtitle | Ignored |
| `image` | First image in the body | First image in the gallery |
| `caption` | Image caption | Italic text in the Note's body |

Without YAML `title`, an article uses its first `# Heading`, then its filename. An opening paragraph entirely in italics supplies the subtitle and takes priority over `metadescription`. Both are removed from the article body.

## Substack Note: complete YAML example

```markdown
---
title: "The first draft"
image: "Photos/river.jpg"
---

A first draft is only the start.

[My blog](https://tcrouzet.com)
```

The title appears in bold, the photograph goes into the gallery, and the link becomes `My blog (https://tcrouzet.com)`.

A Note needs no YAML. For an image-only Note, keep only `image` in the YAML and leave the body empty; neither a title nor a caption is required. Notes support up to 20 images.

## Images

Images can also appear directly in the body:

```markdown
![[Photos/river.jpg]]

![Morning light](https://example.org/river.jpg)
```

An image already in the body is not added again by YAML `image`. Article captions use the image's alternative text, or its HTML figure caption.

Images are resized to **1,600 px maximum width** and encoded only when sent to Substack. Smaller images keep their size. Local files and image links are unchanged. Oversized animated images become still images.

## Optional settings

- **Language editions**: choose a default language and additional editions. Enable additional languages and automatic translation in Substack too. The plugin waits for the selected editions before offering the draft actions.
- **Remove trailing tags**: removes paragraphs containing only hashtags at the end of the export. Off by default.
- **Mastodon account**: enter your server and sign in. While connected, each published Substack Note is also posted to Mastodon. Long text is shortened, preserving its original links. Newsletter articles are not mirrored. If Mastodon fails, the Substack Note remains published.

## Connection, privacy and limits

Credentials use Obsidian's secret storage. Content and images are sent to Substack, and to Mastodon when connected.

Automatic login is desktop-only. On mobile, use **Manual connection → Substack session** to select a secret containing your `substack.sid` cookie or authenticated `Cookie` header, then **Refresh**. The mobile workflow has not been validated. Keep session cookies private.

Tables, PDFs, audio, video and embedded notes are unsupported. The plugin uses Substack's undocumented API, which may change. If publication is not confirmed, check Substack before retrying.

[Report an issue](https://github.com/tcrouzet/obsidian-to-substack/issues) · [Install from Obsidian](https://community.obsidian.md/plugins/to-substack)

An independent, unofficial plugin by [Thierry Crouzet](https://tcrouzet.com).
