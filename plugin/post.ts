import { draftLanguageName, t } from './i18n';
import { App, arrayBufferToBase64, ButtonComponent, Component, getFrontMatterInfo, getLinkpath, MarkdownRenderer, Modal, parseYaml, Setting, TFile } from 'obsidian';
import type ToSubstackPlugin from './main';
import { activateDraftLanguages, createDraft, publishNote, PostContent, PostNode, SubstackError } from './substack';

const NOTE_DESTINATION = ':note';

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

export async function preparePost(app: App, file: TFile, options: { forNote?: boolean; selection?: string; removeTrailingTags?: boolean } = {}): Promise<PostContent> {
	const markdown = options.selection ?? await app.vault.read(file);
	const frontmatter = options.selection === undefined ? getFrontMatterInfo(markdown) : null;
	const container = createDiv();
	const component = new Component();
	component.load();
	try {
		await MarkdownRenderer.render(app, markdown.slice(frontmatter?.contentStart ?? 0), container, file.path, component);
		await encodeImages(app, file, container);
		container.querySelectorAll('button, .collapse-indicator, .heading-collapse-indicator, .list-collapse-indicator').forEach(node => node.remove());
		const heading = options.forNote ? null : container.querySelector('h1');
		const title = heading?.textContent?.trim() || file.basename;
		heading?.remove();
		const body = blocks(container);
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
		if (!options.forNote && !subtitle && frontmatter?.exists) {
			let metadata: unknown;
			try { metadata = parseYaml(frontmatter.frontmatter); }
			catch { throw new SubstackError(t('invalidFrontmatter')); }
			if (metadata && typeof metadata === 'object' && 'metadescription' in metadata) {
				const description = (metadata as Record<string, unknown>).metadescription;
				if (typeof description === 'string') subtitle = description.replace(/\s+/g, ' ').trim();
			}
		}
		return { title, subtitle, body: { type: 'doc', content: body.length ? body : [{ type: 'paragraph' }] } };
	} finally { component.unload(); }
}

export class PostModal extends Modal {
	constructor(private plugin: ToSubstackPlugin, private file: TFile, private selectedMarkdown?: string) { super(plugin.app); }

	onOpen(): void {
		this.titleEl.setText(t('pluginName'));
		const newsletters = this.selectedMarkdown === undefined ? this.plugin.account?.newsletters || [] : [];
		if (!this.plugin.account) {
			this.contentEl.createEl('p', { text: t('draftSetupRequired') });
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
					this.contentEl.createEl('p', { text: t('draftCreated', { title: post.title, newsletter: newsletter.name }) });
					this.contentEl.createEl('a', { text: t('openDraft'), href: url, attr: { target: '_blank', rel: 'noopener' } });
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
				} catch (error) {
					status.setAttribute('role', 'alert');
					status.setText(error instanceof SubstackError ? error.message : t(isNote ? 'notePublicationUncertain' : 'draftFailed'));
					button.setDisabled(isNote);
				}
			});
		});
	}
}
