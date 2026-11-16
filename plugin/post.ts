import { draftLanguageName, t } from './i18n';
import { App, arrayBufferToBase64, ButtonComponent, Component, DropdownComponent, getFrontMatterInfo, getLinkpath, MarkdownRenderer, Modal, parseYaml, requestUrl, Setting, TFile, ToggleComponent } from 'obsidian';
import type ToSubstackPlugin from './main';
import { activateDraftLanguages, createDraft, getSections, Newsletter, publishDraft, publishNote, PostContent, PostNode, SubstackError } from './substack';

const NOTE_DESTINATION = ':note';

async function encodeImages(app: App, file: TFile, container: HTMLElement): Promise<void> {
	const encoded = new Map<string, string>();
	const encode = async (link: string): Promise<string> => {
		if (/^data:image\//i.test(link)) return link;
		if (/^https?:\/\//i.test(link)) {
			let data = encoded.get(link);
			if (!data) {
				try {
					const url = new URL(link);
					if (url.username || url.password) throw new Error();
					const response = await requestUrl({ url: url.href, method: 'GET', throw: false });
					const mime = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1].split(';')[0].trim().toLowerCase() || '';
					if (response.status < 200 || response.status >= 300 || !/^image\/[a-z0-9.+-]+$/.test(mime) || !response.arrayBuffer.byteLength) throw new Error();
					data = `data:${mime};base64,${arrayBufferToBase64(response.arrayBuffer)}`;
					encoded.set(link, data);
				} catch { throw new SubstackError(t('imageEmbedFailed')); }
			}
			return data;
		}
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

function inline(node: Node, marks: NonNullable<PostNode['marks']> = [], includeCaptions = false): PostNode[] {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ type: 'text', text: node.textContent, ...(marks.length ? { marks } : {}) }] : [];
	if (!node.instanceOf(HTMLElement)) return [];
	if (node.tagName === 'BR') return [{ type: 'hardBreak' }];
	if (includeCaptions && node.tagName === 'FIGCAPTION') return [];
	if (node.tagName === 'IMG') {
		const src = node.getAttribute('src') || '';
		if (!/^(https?:\/\/|data:image\/)/i.test(src)) throw new SubstackError(t('imageEmbedFailed'));
		const alt = node.getAttribute('alt') || '';
		const image: PostNode = { type: 'image2', attrs: { src, alt, fullscreen: false } };
		if (includeCaptions) {
			const figureCaption = node.closest('figure')?.querySelector('figcaption');
			const caption = figureCaption ? inline(figureCaption) : [{ type: 'text', text: alt }];
			if (caption.some(child => child.text?.trim())) return [{ type: 'captionedImage', content: [image, { type: 'caption', content: caption }] }];
		}
		return [image];
	}
	const mark = ({ STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', CODE: 'code' } as Record<string, string>)[node.tagName];
	if (mark) marks = [...marks, { type: mark }];
	const href = node.getAttribute('href');
	if (node.tagName === 'A' && href && /^(https?:\/\/|mailto:|#)/i.test(href)) marks = [...marks, { type: 'link', attrs: { href } }];
	const result: PostNode[] = [];
	for (const child of Array.from(node.childNodes)) result.push(...inline(child, marks, includeCaptions));
	return result;
}

function blocks(parent: Element, includeCaptions = false): PostNode[] {
	const result: PostNode[] = [];
	let pending: PostNode[] = [];
	const flush = (): void => {
		if (pending.some(node => node.type !== 'text' || node.text?.trim())) result.push({ type: 'paragraph', content: pending });
		pending = [];
	};
	for (const child of Array.from(parent.childNodes)) {
		if (!child.instanceOf(HTMLElement)) { pending.push(...inline(child, [], includeCaptions)); continue; }
		const tag = child.tagName;
		if (tag === 'IMG') { flush(); result.push(...inline(child, [], includeCaptions)); }
		else if (tag === 'P') {
			flush();
			for (const item of inline(child, [], includeCaptions)) {
				if (item.type === 'image2' || item.type === 'captionedImage') { flush(); result.push(item); }
				else pending.push(item);
			}
			flush();
		} else if (/^H[1-6]$/.test(tag)) { flush(); result.push({ type: 'heading', attrs: { level: Number(tag[1]) }, content: inline(child, [], includeCaptions) }); }
		else if (tag === 'HR') { flush(); result.push({ type: 'horizontal_rule' }); }
		else if (tag === 'PRE') { flush(); result.push({ type: 'codeBlock', content: child.textContent ? [{ type: 'text', text: child.textContent }] : [] }); }
		else if (['UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV', 'FIGURE'].includes(tag)) {
			flush();
			const content = blocks(child, includeCaptions);
			if (tag === 'DIV' || tag === 'FIGURE') result.push(...content);
			else result.push({ type: ({ UL: 'bulletList', OL: 'orderedList', LI: 'listItem', BLOCKQUOTE: 'blockquote' } as Record<string, string>)[tag], content });
		} else if (tag === 'TABLE') {
			throw new SubstackError(t('tablesUnsupported'));
		} else pending.push(...inline(child, [], includeCaptions));
	}
	flush();
	return result;
}

export async function preparePost(app: App, file: TFile, options: { forNote?: boolean; selection?: string; removeTrailingTags?: boolean } = {}): Promise<PostContent> {
	const markdown = options.selection ?? await app.vault.read(file);
	const frontmatter = options.selection === undefined ? getFrontMatterInfo(markdown) : null;
	const container = createDiv();
	const component = new Component();
	component.load();
	try {
		let metadata: unknown;
		try { metadata = frontmatter?.exists ? parseYaml(frontmatter.frontmatter) : null; }
		catch { throw new SubstackError(t('invalidFrontmatter')); }
		const properties = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
		await MarkdownRenderer.render(app, markdown.slice(frontmatter?.contentStart ?? 0), container, file.path, component);
		const imageSource = typeof properties.image === 'string' ? properties.image.trim() : '';
		let cover = imageSource ? container.createEl('img', { attr: { src: imageSource } }) : null;
		await encodeImages(app, file, container);
		if (cover) {
			const duplicate = Array.from(container.querySelectorAll('img')).some(image => image !== cover && image.src === cover?.src);
			cover.remove();
			if (duplicate) cover = null;
		}
		container.querySelectorAll('button, .collapse-indicator, .heading-collapse-indicator, .list-collapse-indicator').forEach(node => node.remove());
		const heading = options.forNote ? null : container.querySelector('h1');
		const title = heading?.textContent?.trim() || file.basename;
		heading?.remove();
		const body = blocks(container, !options.forNote);
		if (options.removeTrailingTags) {
			const isTag = (node: PostNode): boolean => node.type === 'hardBreak' || node.type === 'text' && (!node.text?.trim()
				|| (/^#[^\s#]+$/.test(node.text) && node.marks?.some(mark => mark.type === 'link' && mark.attrs?.href?.startsWith('#')) === true));
			while (body.length) {
				const last = body[body.length - 1];
				if (last.type !== 'paragraph' || !last.content?.length || !last.content.every(isTag)) break;
				body.pop();
			}
		}
		const first = body[0];
		let subtitle = '';
		if (!options.forNote && first?.type === 'paragraph' && first.content?.some(node => node.text?.trim()) && first.content.every(node => node.type === 'hardBreak' || (node.type === 'text' && (!node.text?.trim() || node.marks?.some(mark => mark.type === 'em'))))) {
			subtitle = first.content.map(node => node.type === 'hardBreak' ? ' ' : node.text || '').join('').replace(/\s+/g, ' ').trim();
			body.shift();
		}
		if (!options.forNote && !subtitle && typeof properties.metadescription === 'string') {
			subtitle = properties.metadescription.replace(/\s+/g, ' ').trim();
		}
		if (cover) body.unshift(...inline(cover, [], !options.forNote));
		return { title, subtitle, body: { type: 'doc', content: body.length ? body : [{ type: 'paragraph' }] } };
	} finally { component.unload(); }
}

export class PostModal extends Modal {
	constructor(private plugin: ToSubstackPlugin, private file: TFile, private selectedMarkdown?: string) { super(plugin.app); }

	async onOpen(): Promise<void> {
		this.titleEl.setText(t('pluginName'));
		if (!this.plugin.account && this.plugin.settings.sessionSecretId) {
			this.contentEl.createEl('p', { text: t('loadingNewsletters'), attr: { role: 'status' } });
			await this.plugin.connect(false);
			if (!this.modalEl.isConnected) return;
			this.contentEl.empty();
		}
		const newsletters = this.selectedMarkdown === undefined ? this.plugin.account?.newsletters || [] : [];
		if (!this.plugin.account) {
			this.contentEl.createEl('p', { text: this.plugin.error || t('draftSetupRequired'), attr: { role: 'alert' } });
			return;
		}
		let selected = newsletters[0]?.subdomain || NOTE_DESTINATION;
		let submit: ButtonComponent;
		const description = this.contentEl.createEl('p');
		const updateDescription = (): void => { description.setText(this.selectedMarkdown !== undefined ? t('publishSelectedText') : t(selected === NOTE_DESTINATION ? 'publishNoteFromNote' : 'createDraftFromNote', { note: this.file.basename })); };
		updateDescription();
		new Setting(this.contentEl).setName(t('destination')).addDropdown(dropdown => {
			dropdown.selectEl.setAttribute('aria-label', t('destination'));
			dropdown.addOption(NOTE_DESTINATION, t('noteDestination'));
			for (const newsletter of newsletters) dropdown.addOption(newsletter.subdomain, newsletter.name);
			dropdown.setValue(selected).onChange(value => {
				selected = value;
				submit.setButtonText(t(selected === NOTE_DESTINATION ? 'publishNote' : 'createDraft'));
				updateDescription();
			});
		});
		const status = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
		new Setting(this.contentEl).addButton(button => {
			submit = button;
			button.setButtonText(t(selected === NOTE_DESTINATION ? 'publishNote' : 'createDraft')).setCta().onClick(async () => {
				const isNote = selected === NOTE_DESTINATION;
				button.setDisabled(true);
				status.setAttribute('role', 'status');
				status.setText(t(isNote ? 'publishingNote' : 'creatingDraft'));
				try {
					const newsletter = newsletters.find(item => item.subdomain === selected);
					const session = this.app.secretStorage.getSecret(this.plugin.settings.sessionSecretId);
					if (!session || (!isNote && !newsletter)) throw new SubstackError(t('reconnectAccount'));
					const post = await preparePost(this.app, this.file, { forNote: isNote, selection: this.selectedMarkdown, removeTrailingTags: this.plugin.settings.removeTrailingTags });
					if (isNote) {
						const url = await publishNote(session, post.body);
						this.contentEl.empty();
						this.contentEl.createEl('p', { text: t('notePublished') });
						this.contentEl.createEl('a', { text: t('openNote'), href: url, attr: { target: '_blank', rel: 'noopener' } });
						return;
					}
					if (!newsletter) throw new SubstackError(t('invalidNewsletter'));
					const url = await createDraft(session, newsletter, post);
					this.contentEl.empty();
					const languageStatus = this.contentEl.createEl('p', { text: t('checkingDraftLanguages'), attr: { role: 'status', 'aria-live': 'polite' } });
					try {
						const activated = await activateDraftLanguages(session, newsletter, url.slice(url.lastIndexOf('/') + 1), language => {
							languageStatus.setText(t('activatingDraftLanguage', { language: draftLanguageName(language) }));
						}, this.plugin.settings.translationLanguages, this.plugin.settings.defaultLanguage);
						if (activated) languageStatus.setText(t('draftLanguagesReady'));
						else languageStatus.remove();
					} catch {
						languageStatus.setAttribute('role', 'alert');
						languageStatus.setText(t('draftLanguagesFailed'));
					}
					this.contentEl.prepend(
						this.contentEl.createEl('p', { text: t('draftCreated', { title: post.title, newsletter: newsletter.name }) }),
						this.contentEl.createEl('a', { text: t('openDraft'), href: url, attr: { target: '_blank', rel: 'noopener' } })
					);
					await this.showPublicationControls(session, newsletter, url.slice(url.lastIndexOf('/') + 1), post.title);
				} catch (error) {
					status.setAttribute('role', 'alert');
					status.setText(error instanceof SubstackError ? error.message : t(isNote ? 'notePublicationUncertain' : 'draftFailed'));
					button.setDisabled(isNote);
				}
			});
		});
	}

	private async showPublicationControls(session: string, newsletter: Newsletter, draftId: string, title: string): Promise<void> {
		const status = this.contentEl.createEl('p', { text: t('loadingCategories'), attr: { role: 'status', 'aria-live': 'polite' } });
		try {
			const sections = await getSections(session, newsletter);
			if (!this.modalEl.isConnected) return;
			status.empty();
			let sectionId: number | null = null;
			let sendEmail = true;
			let publishing = false;
			let category: DropdownComponent | undefined;
			let email: ToggleComponent;
			if (sections.length) new Setting(this.contentEl).setName(t('category')).addDropdown(dropdown => {
				category = dropdown;
				dropdown.selectEl.setAttribute('aria-label', t('category'));
				dropdown.addOption('', t('mainPublication'));
				for (const section of sections) dropdown.addOption(String(section.id), section.name);
				dropdown.onChange(value => { sectionId = value ? Number(value) : null; });
			});
			new Setting(this.contentEl).setName(t('sendEmail')).setDesc(t('sendEmailHelp')).addToggle(toggle => {
				email = toggle;
				toggle.setValue(sendEmail).onChange(value => { sendEmail = value; });
			});
			new Setting(this.contentEl).addButton(button => button.setButtonText(t('publishDraft')).setCta().onClick(async () => {
				if (publishing) return;
				publishing = true;
				button.setDisabled(true);
				category?.setDisabled(true);
				email.setDisabled(true);
				status.setAttribute('role', 'status');
				status.setText(t('publishingDraft'));
				try {
					const url = await publishDraft(session, newsletter, draftId, sectionId, sendEmail);
					if (!this.modalEl.isConnected) return;
					this.contentEl.empty();
					this.contentEl.createEl('p', { text: t('draftPublished', { title }), attr: { role: 'status' } });
					this.contentEl.createEl('a', { text: t('openPublishedPost'), href: url, attr: { target: '_blank', rel: 'noopener' } });
				} catch (error) {
					status.setAttribute('role', 'alert');
					status.setText(error instanceof SubstackError ? error.message : t('draftPublicationUncertain'));
				}
			}));
		} catch (error) {
			status.setAttribute('role', 'alert');
			status.setText(error instanceof SubstackError ? error.message : t('categoriesFailed'));
		}
	}
}
