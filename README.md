# To Substack

**From an Obsidian note to a Substack draft or Note.**

Write in Obsidian, choose your newsletter, and create a Substack draft with your title, subtitle, formatted text, and images. Or choose **Note** to publish directly to your Substack Notes feed. Your original note and attachments stay unchanged.

[Install To Substack from Obsidian](https://community.obsidian.md/plugins/to-substack) · [Report an issue](https://github.com/tcrouzet/obsidian-to-substack/issues)

## Install To Substack

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **To Substack**, then select **Install** and **Enable**.
3. Open **Settings → To Substack** to connect your account.

Requires **Obsidian 1.14 or later** and a Substack account. Newsletter drafts require access to a newsletter; publishing Notes does not.

The interface follows the language selected in Obsidian: English or French, with English used for other languages.

## Connect your Substack account

1. Open **Settings → To Substack** and click **Sign in**.
2. Sign in on the Substack page that opens in a separate window. If Substack emails you a verification code, enter it in that same window.
3. Once your account is validated, the sign-in window closes automatically and your newsletters appear in the settings.

After checking your email, **Return to sign-in** brings the Substack window back to the front, including when it has been minimized. **Cancel** closes it and stops waiting for a connection.

Use **Refresh** to reload your newsletters, **Switch account** to connect another account, or **Disconnect** to remove the saved connection.

## Connect Mastodon

1. Under **Settings → To Substack → Mastodon account**, enter your **Mastodon server**, such as `mastodon.social`.
2. Click **Sign in** and authorize To Substack in your browser.
3. The browser returns to Obsidian and the connected account appears in the settings. Use **Disconnect** to stop mirroring and revoke the connection.

While Mastodon is connected, publishing a Substack **Note** also posts its text and images to Mastodon. This applies to selected excerpts too; newsletter articles stay on Substack. If the text is too long for the server, it is shortened with `...` and its original links are kept in full at the end. No link to the Substack Note is added. If the original links alone cannot fit, the Mastodon copy is not sent and an error is shown. Images keep their alternative descriptions and must meet the server's image-count, format, and size limits.

Substack is published first. Both post links are shown when Mastodon confirms the copy. If Mastodon fails, the confirmed Substack link stays available and the error is shown separately. The plugin never republishes the Substack Note to retry Mastodon, and never silently drops excess images.

## Create a draft from a note

1. Right-click a Markdown note in Obsidian's file explorer.
2. Choose **To Substack**.
3. Select the newsletter and click **Create draft**.
4. Follow **Open draft in Substack** to review your post.

Each export creates a new draft. Once its language editions are ready, choose a **Category** if the newsletter has sections. Your choice is saved automatically to the draft, even if you close the window without publishing or opening Substack. Once Substack confirms the category, the plugin offers **Close**, **Publish**, and **Open draft in Substack**. If there are no categories, these actions appear directly. **Close** leaves the article as a draft. **Publish** publishes the article and emails subscribers. **Open draft in Substack** opens Substack and closes the plugin window. If publication cannot be confirmed, **Open draft in Substack** remains available; the plugin never retries publication automatically.

Under **Settings → To Substack → Language editions**, choose your notes' **Default language**, then check the other languages to add to Substack drafts. The default initially follows Obsidian's language when supported, or English otherwise. English, Spanish, German, Italian, European Portuguese, and French are supported; the other languages are initially checked. Uncheck every additional language to disable automatic editions. Your choices apply to future drafts.

If **Additional post languages** and **Allow automatic translation** are enabled in your Substack publication settings, To Substack prepares the selected editions. It skips the default language and the post's detected original language. Existing editions are preserved.

The plugin waits for Substack to generate the editions, then checks that they were saved before reporting them as ready. If a language cannot be confirmed, **Open draft in Substack** remains available so you can review the editions there.

| In your note | In the Substack draft |
| --- | --- |
| YAML `title`, or the first level-one heading, `# Title` | Post title |
| The opening paragraph, if it is entirely italic; otherwise YAML `metadescription`, when present | Subtitle |
| The remaining text | Formatted post body |
| Embedded images | Images in the post body |
| YAML properties | Excluded from the export |

A non-empty YAML `title` takes priority over the first level-one heading. If neither is available, the filename without `.md` becomes the title. The first level-one heading and opening italic paragraph are removed from the exported article body. If there is no italic opening paragraph, the YAML `metadescription` property supplies the subtitle. Paragraphs, headings, bold, italics, web links, lists, blockquotes, inline code, code blocks, and horizontal rules keep their formatting.

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

A YAML `image` property containing a vault path or an image URL supplies the first image: at the start of an article's body, below its title and subtitle, or first in a Note's gallery. If the same image is already embedded in the text, it stays in its original position and is not added again. Publishing selected text ignores the note's YAML image.

Use YAML `caption` for this image's caption. It appears as an image caption in articles and as italic text in Notes. If the image is already embedded in the body, its existing caption is preserved.

Local and linked images are resized to a maximum width of 1,600 pixels, encoded in base64, and uploaded when creating the Substack draft or publishing the Note. Smaller images retain their size. Local Markdown keeps its original image links; encoded images are never written back to the note. Their position and alternative text are preserved, and a repeated image is uploaded once per draft. Image labels become visible captions; an HTML figure's explicit caption takes priority and keeps its formatting. The files in your vault are left intact.

If an image cannot be found or uploaded, the plugin stops before creating the draft and shows an error. If a connection error leaves the result of draft creation uncertain, check your Substack drafts before trying again.

## Publish a Substack Note

1. Right-click a Markdown note and choose **To Substack**.
2. In **Destination**, select **Note** alongside your available newsletters.
3. Click **Publish note**. This publishes immediately to the connected account's Notes feed.
4. Follow **Open note in Substack** to view it.

To publish an excerpt, select text in the editor and choose **To Substack** from its context menu. Only **Note** is offered, and only the selected text and its images are sent. Without a selection, the destination chooser offers Note and your newsletters.

The title and opening italic paragraph remain in the Note's text. Headings become bold paragraphs; lists, quotes, links, and code retain their formatting. Images appear as gallery attachments, with a maximum of 20 unique images. Notes use Substack's own layout rather than inline image positions. Language edition settings apply to newsletter drafts.

If the YAML has a non-empty `title`, it appears in bold at the top of the Note, before any image or body text. A matching level-one heading is not repeated. Publishing selected text ignores the YAML title.

If Substack does not confirm publication, check your Notes before trying again. The plugin never retries publication automatically.

## Remove trailing tags

Enable **Settings → To Substack → Export → Remove trailing tags** to omit paragraphs containing only hashtags at the end of an article or Note. The option is off by default. Tags within the text and tags in code are preserved; your Obsidian file stays unchanged.

## Account and privacy

Creating a draft or publishing a Note sends the selected content and images to Substack. When Mastodon is connected, Notes are also sent to that Mastodon server. Publishing an article makes it public and emails subscribers. Opening a draft for review does not publish it. Linked images are downloaded from their hosts without your Substack session. Substack and Mastodon credentials are kept in **Obsidian's secret storage**; the plugin settings contain only secret references and the Mastodon server address.

Mastodon authorization requests permission to identify your account and publish statuses and media. Its token is used only with the server you authorized. Mastodon passwords are entered in your browser, and the plugin does not receive them. Secret storage is local to each device; authorize Mastodon separately on each device you use.

Disconnecting removes the connection and clears the session secret created by To Substack. Secrets you imported from elsewhere remain available in Obsidian's secret storage.

### Manual session setup

If the sign-in window is unavailable, open **Manual connection → Substack session** in the plugin settings. Choose or create a secret containing your `substack.sid` cookie value or the complete `Cookie` header from an authenticated Substack session, then click **Refresh**.

A session cookie grants access to your account. Keep it private.

## Compatibility and limits

- The automatic sign-in window is available on desktop. Mobile requires manual session setup; the mobile workflow has not yet been validated on iOS or Android.
- Tables and embedded files other than images, including PDFs, audio, video, and embedded notes, are not supported.
- To Substack uses Substack's undocumented API. Changes to Substack may affect the connection, draft creation, or Note publication.

## Questions or ideas?

[Open an issue on GitHub](https://github.com/tcrouzet/obsidian-to-substack/issues) with your Obsidian version, operating system, the error message, and a short example note. Remove session cookies and private information before sharing logs or screenshots.

To Substack is an independent, unofficial plugin by [Thierry Crouzet](https://tcrouzet.com).
