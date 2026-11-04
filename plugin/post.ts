import { t } from './i18n';
import { App, arrayBufferToBase64, Component, getFrontMatterInfo, getLinkpath, MarkdownRenderer, Modal, Setting, TFile } from 'obsidian';
import type ToSubstackPlugin from './main';
import { createDraft, PostContent, PostNode, SubstackError } from './substack';

async function encodeImages(app: App, file: TFile, container: HTMLElement): Promise<void> {
	const encoded = new Map<string, string>();
	const encode = async (link: string): Promise<string> => {
		if (/^(https?:\/\/|data:image\/)/i.test(link)) return link;
		const path = getLinkpath(link);
		let attachment = app.metadataCache.getFirstLinkpathDest(path, file.path);
		if (!attachment) {
			try { attachment = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(path), file.path); } catch { /* A filename may contain a literal percent sign. */ }
		}
		if (!attachment) {
			// Obsidian rewrites HTML image sources to vault resource URLs.
			try {
				const source = new URL(app.vault.getResourcePath(file));
				const destination = new URL(link);
				const sourcePath = decodeURIComponent(source.pathname);
				const destinationPath = decodeURIComponent(destination.pathname);
				const root = sourcePath.slice(0, -file.path.length);
				if (source.protocol === destination.protocol && source.host === destination.host && sourcePath.endsWith(file.path) && destinationPath.startsWith(root)) {
					attachment = app.vault.getFileByPath(destinationPath.slice(root.length));
				}
			} catch { /* Relative links have already been resolved through the metadata cache. */ }
		}
		if (!attachment) throw new SubstackError(t('imageNotFound', { file: link }));
		const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' } as Record<string, string>)[attachment.extension.toLowerCase()];
		if (!mime) throw new SubstackError(t('unsupportedImage', { file: attachment.name }));
		let data = encoded.get(attachment.path);
		if (!data) {
			data = `data:${mime};base64,${arrayBufferToBase64(await app.vault.readBinary(attachment))}`;
			encoded.set(attachment.path, data);
		}
		return data;
	};
	for (const embed of Array.from(container.querySelectorAll<HTMLElement>('.internal-embed'))) {
		const image = createEl('img');
		image.src = await encode(embed.getAttribute('src') || '');
		image.alt = embed.getAttribute('alt') || '';
		embed.replaceWith(image);
	}
	for (const image of Array.from(container.querySelectorAll('img'))) image.src = await encode(image.getAttribute('src') || '');
}

function inline(node: Node, marks: NonNullable<PostNode['marks']> = []): PostNode[] {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ type: 'text', text: node.textContent, ...(marks.length ? { marks } : {}) }] : [];
	if (!node.instanceOf(HTMLElement)) return [];
	if (node.tagName === 'BR') return [{ type: 'hardBreak' }];
	if (node.tagName === 'IMG') {
		const src = node.getAttribute('src') || '';
		if (!/^(https?:\/\/|data:image\/)/i.test(src)) throw new SubstackError(t('imageEmbedFailed'));
		return [{ type: 'image2', attrs: { src, alt: node.getAttribute('alt') || '', fullscreen: false } }];
	}
	const mark = ({ STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', CODE: 'code' } as Record<string, string>)[node.tagName];
	if (mark) marks = [...marks, { type: mark }];
	const href = node.getAttribute('href');
	if (node.tagName === 'A' && href && /^(https?:\/\/|mailto:|#)/i.test(href)) marks = [...marks, { type: 'link', attrs: { href } }];
	const result: PostNode[] = [];
	for (const child of Array.from(node.childNodes)) result.push(...inline(child, marks));
	return result;
}

function blocks(parent: Element): PostNode[] {
	const result: PostNode[] = [];
	let pending: PostNode[] = [];
	const flush = (): void => {
		if (pending.some(node => node.type !== 'text' || node.text?.trim())) result.push({ type: 'paragraph', content: pending });
		pending = [];
	};
	for (const child of Array.from(parent.childNodes)) {
		if (!child.instanceOf(HTMLElement)) { pending.push(...inline(child)); continue; }
		const tag = child.tagName;
		if (tag === 'IMG') { flush(); result.push(...inline(child)); }
		else if (tag === 'P') {
			flush();
			for (const item of inline(child)) {
				if (item.type === 'image2') { flush(); result.push(item); }
				else pending.push(item);
			}
			flush();
		} else if (/^H[1-6]$/.test(tag)) { flush(); result.push({ type: 'heading', attrs: { level: Number(tag[1]) }, content: inline(child) }); }
		else if (tag === 'HR') { flush(); result.push({ type: 'horizontal_rule' }); }
		else if (tag === 'PRE') { flush(); result.push({ type: 'codeBlock', content: child.textContent ? [{ type: 'text', text: child.textContent }] : [] }); }
		else if (['UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV'].includes(tag)) {
			flush();
			const content = blocks(child);
			if (tag === 'DIV') result.push(...content);
			else result.push({ type: ({ UL: 'bulletList', OL: 'orderedList', LI: 'listItem', BLOCKQUOTE: 'blockquote' } as Record<string, string>)[tag], content });
		} else if (tag === 'TABLE') {
			throw new SubstackError(t('tablesUnsupported'));
		} else pending.push(...inline(child));
	}
	flush();
	return result;
}

export async function preparePost(app: App, file: TFile): Promise<PostContent> {
	const markdown = await app.vault.read(file);
	const container = createEl('div');
	const component = new Component();
	component.load();
	try {
		await MarkdownRenderer.render(app, markdown.slice(getFrontMatterInfo(markdown).contentStart), container, file.path, component);
		await encodeImages(app, file, container);
		container.querySelectorAll('button, .collapse-indicator, .heading-collapse-indicator, .list-collapse-indicator').forEach(node => node.remove());
		const heading = container.querySelector('h1');
		const title = heading?.textContent?.trim() || file.basename;
		heading?.remove();
		const body = blocks(container);
		const first = body[0];
		let subtitle = '';
		if (first?.type === 'paragraph' && first.content?.some(node => node.text?.trim()) && first.content.every(node => node.type === 'hardBreak' || (node.type === 'text' && (!node.text?.trim() || node.marks?.some(mark => mark.type === 'em'))))) {
			subtitle = first.content.map(node => node.type === 'hardBreak' ? ' ' : node.text || '').join('').replace(/\s+/g, ' ').trim();
			body.shift();
		}
		return { title, subtitle, body: { type: 'doc', content: body.length ? body : [{ type: 'paragraph' }] } };
	} finally { component.unload(); }
}

export class PostModal extends Modal {
	constructor(private plugin: ToSubstackPlugin, private file: TFile) { super(plugin.app); }

	onOpen(): void {
		this.titleEl.setText(t('pluginName'));
		const newsletters = this.plugin.account?.newsletters || [];
		if (!newsletters.length) {
			this.contentEl.createEl('p', { text: t('draftSetupRequired') });
			return;
		}
		let selected = newsletters[0].subdomain;
		this.contentEl.createEl('p', { text: t('createDraftFromNote', { note: this.file.basename }) });
		new Setting(this.contentEl).setName(t('newsletter')).addDropdown(dropdown => {
			dropdown.selectEl.setAttribute('aria-label', t('newsletter'));
			for (const newsletter of newsletters) dropdown.addOption(newsletter.subdomain, newsletter.name);
			dropdown.setValue(selected).onChange(value => { selected = value; });
		});
		const status = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
		new Setting(this.contentEl).addButton(button => button.setButtonText(t('createDraft')).setCta().onClick(async () => {
			button.setDisabled(true);
			status.setAttribute('role', 'status');
			status.setText(t('creatingDraft'));
			try {
				const newsletter = newsletters.find(item => item.subdomain === selected);
				const session = this.app.secretStorage.getSecret(this.plugin.settings.sessionSecretId);
				if (!session || !newsletter) throw new SubstackError(t('reconnectAccount'));
				const post = await preparePost(this.app, this.file);
				const url = await createDraft(session, newsletter, post);
				this.contentEl.empty();
				this.contentEl.createEl('p', { text: t('draftCreated', { title: post.title, newsletter: newsletter.name }) });
				this.contentEl.createEl('a', { text: t('openDraft'), href: url, attr: { target: '_blank', rel: 'noopener' } });
			} catch (error) {
				status.setAttribute('role', 'alert');
				status.setText(error instanceof SubstackError ? error.message : t('draftFailed'));
				button.setDisabled(false);
			}
		}));
	}
}
