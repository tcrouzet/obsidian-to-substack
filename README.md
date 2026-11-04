# To Substack

**From an Obsidian note to a Substack draft.**

Write in Obsidian, choose your newsletter, and create a Substack draft with your title, subtitle, formatted text, and images. Open the draft in Substack to review it and publish when you are ready. Your original note and attachments stay unchanged.

[Install To Substack from Obsidian](https://community.obsidian.md/plugins/to-substack) · [Report an issue](https://github.com/tcrouzet/obsidian-to-substack/issues)

## Install To Substack

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **To Substack**, then select **Install** and **Enable**.
3. Open **Settings → To Substack** to connect your account.

Requires **Obsidian 1.14 or later** and a Substack account with access to a newsletter.

The interface follows the language selected in Obsidian: English or French, with English used for other languages.

## Connect your Substack account

1. Open **Settings → To Substack** and click **Sign in**.
2. Sign in on the Substack page that opens in a separate window. If Substack emails you a verification code, enter it in that same window.
3. Once your account is validated, the sign-in window closes automatically and your newsletters appear in the settings.

After checking your email, **Return to sign-in** brings the Substack window back to the front, including when it has been minimized. **Cancel** closes it and stops waiting for a connection.

Use **Refresh** to reload your newsletters, **Switch account** to connect another account, or **Disconnect** to remove the saved connection.

## Create a draft from a note

1. Right-click a Markdown note in Obsidian's file explorer.
2. Choose **To Substack**.
3. Select the newsletter and click **Create draft**.
4. Follow **Open draft in Substack** to review your post.

Each export creates a new draft. You control publication and email delivery in Substack.

| In your note | In the Substack draft |
| --- | --- |
| The first level-one heading, `# Title` | Post title |
| The opening paragraph, if it is entirely italic | Subtitle |
| The remaining text | Formatted post body |
| Embedded images | Images in the post body |
| YAML properties | Excluded from the export |

If the note has no level-one heading, its filename without `.md` becomes the title. The extracted title and subtitle are removed from the exported body. Paragraphs, headings, bold, italics, web links, lists, blockquotes, inline code, code blocks, and horizontal rules keep their formatting.

For example:

```markdown
# A walk by the river

*Notes from an autumn morning.*

The river was quiet. **The light changed everything.**

![[Photos/river.jpg]]
```

The draft is titled **A walk by the river**, with **Notes from an autumn morning.** as its subtitle. The body contains the paragraph and the photograph.

## Include your images

Use Obsidian image embeds such as `![[photo.jpg]]`, Markdown images such as `![A view of the river](photo.jpg)`, or HTML `<img>` tags. Relative paths and filenames containing spaces are supported.

Local images are uploaded to the selected newsletter before the draft is created. Their position and alternative text are preserved, and a repeated image is uploaded once per draft. Images already hosted online keep their web address. The files in your vault are left intact.

If an image cannot be found or uploaded, the plugin stops before creating the draft and shows an error. If a connection error leaves the result of draft creation uncertain, check your Substack drafts before trying again.

## Account and privacy

Creating a draft sends the selected note's title, subtitle, body, and local images to Substack. Your session is kept in **Obsidian's secret storage**; the plugin settings contain only a reference to that secret.

Disconnecting removes the connection and clears the session secret created by To Substack. Secrets you imported from elsewhere remain available in Obsidian's secret storage.

### Manual session setup

If the sign-in window is unavailable, open **Manual connection → Substack session** in the plugin settings. Choose or create a secret containing your `substack.sid` cookie value or the complete `Cookie` header from an authenticated Substack session, then click **Refresh**.

A session cookie grants access to your account. Keep it private.

## Compatibility and limits

- The automatic sign-in window is available on desktop. Mobile requires manual session setup; the mobile workflow has not yet been validated on iOS or Android.
- Tables and embedded files other than images, including PDFs, audio, video, and embedded notes, are not supported.
- To Substack uses Substack's undocumented API. Changes to Substack may affect the connection or draft creation.

## Install from the terminal

Requires **Bash and curl**: on macOS or Linux, or on Windows with Git Bash.

Close Obsidian, replace `/path/to/My vault` with your vault's path, and run:

```bash
(
  set -eu
  cd "/path/to/My vault/.obsidian"
  download_dir=$(mktemp -d)
  trap 'rm -rf -- "$download_dir"' EXIT

  for file in main.js manifest.json styles.css; do
    curl -fL "https://github.com/tcrouzet/obsidian-to-substack/releases/latest/download/$file" \
      -o "$download_dir/$file"
  done

  mkdir -p plugins/to-substack
  cp "$download_dir/"* plugins/to-substack/
)
```

The downloads finish before the installed plugin files are replaced. Your notes, attachments, and existing plugin settings are preserved. If your vault uses a different configuration folder, replace `.obsidian` in the command.

Reopen Obsidian and enable **To Substack** in **Settings → Community plugins**. To update, close Obsidian and run the same commands again.

## Install manually

1. Open the [latest release](https://github.com/tcrouzet/obsidian-to-substack/releases/latest) and download `main.js`, `manifest.json`, and `styles.css`.
2. Create `.obsidian/plugins/to-substack/` inside your vault and place those files in it.
3. Restart Obsidian and enable **To Substack** in **Settings → Community plugins**.

On macOS, press `Cmd+Shift+.` in Finder to show hidden folders. If you use a custom configuration folder, replace `.obsidian` with its name.

## Questions or ideas?

[Open an issue on GitHub](https://github.com/tcrouzet/obsidian-to-substack/issues) with your Obsidian version, operating system, the error message, and a short example note. Remove session cookies and private information before sharing logs or screenshots.

To Substack is an independent, unofficial plugin by [Thierry Crouzet](https://tcrouzet.com).
