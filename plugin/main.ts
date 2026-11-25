import { installDevelopment } from './development';
import type { SettingDefinitionItem } from 'obsidian';
import { setLocale, t } from './i18n';
import { addIcon, getLanguage, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import substackIcon from '../icon.svg';
import { PostModal } from './post';
import { SubstackLogin } from './auth';
import { SubstackSettingTab } from './settings';
import { DRAFT_LANGUAGES, DraftLanguage, getAccount, SubstackAccount, SubstackError } from './substack';
import { beginMastodonLogin, completeMastodonLogin, MastodonError, MastodonLogin, MastodonSession, parseMastodonSession, revokeMastodonSession } from './mastodon';

const SESSION_SECRET = 'obsidian-to-substack-session';
const MASTODON_SECRET = 'to-substack-mastodon-session';

export default class ToSubstackPlugin extends Plugin {
	developmentSettings: () => SettingDefinitionItem[] = () => [];
	refreshDevelopmentSettings(): void { this.settingsTab.update(); }

	settings = { sessionSecretId: '', defaultLanguage: 'en' as DraftLanguage, translationLanguages: [...DRAFT_LANGUAGES], removeTrailingTags: false, mastodonServer: '', mastodonSecretId: '' };
	account: SubstackAccount | null = null;
	activity = '';
	error = '';
	mastodonAccount = '';
	mastodonBusy = false;
	mastodonError = '';
	private mastodonLogin: MastodonLogin | null = null;
	private mastodonOperation = 0;
	private operation = 0;
	private connection: Promise<void> = Promise.resolve();
	private login = new SubstackLogin();
	private settingsTab: SubstackSettingTab;

	get busy(): boolean {
		return this.activity !== '';
	}

	get hasLoginWindow(): boolean {
		return this.login.isOpen;
	}

	get hasMastodonLogin(): boolean { return this.mastodonLogin !== null; }

	getMastodonSession(): MastodonSession | null {
		const value = this.settings.mastodonSecretId ? this.app.secretStorage.getSecret(this.settings.mastodonSecretId) : null;
		return value ? parseMastodonSession(value) : null;
	}

	async onload(): Promise<void> {
		setLocale(getLanguage());
		const appLanguage = getLanguage().toLowerCase().replace(/_/g, '-').split('-')[0];
		this.settings.defaultLanguage = DRAFT_LANGUAGES.find(language => language === appLanguage) ?? 'en';
		addIcon('to-substack', substackIcon);
		const saved: unknown = await this.loadData();
		if (saved && typeof saved === 'object') {
			const data = saved as Record<string, unknown>;
			const value = data.sessionSecretId;
			if (typeof value === 'string' && /^[a-z0-9-]+$/.test(value)) this.settings.sessionSecretId = value;
			const defaultLanguage = DRAFT_LANGUAGES.find(language => language === data.defaultLanguage);
			if (defaultLanguage) this.settings.defaultLanguage = defaultLanguage;
			const languages = data.translationLanguages;
			if (Array.isArray(languages)) this.settings.translationLanguages = DRAFT_LANGUAGES.filter(language => languages.includes(language));
			if (typeof data.removeTrailingTags === 'boolean') this.settings.removeTrailingTags = data.removeTrailingTags;
			if (typeof data.mastodonServer === 'string') this.settings.mastodonServer = data.mastodonServer;
			if (typeof data.mastodonSecretId === 'string' && /^[a-z0-9-]+$/.test(data.mastodonSecretId)) this.settings.mastodonSecretId = data.mastodonSecretId;
		}
		try {
			const session = this.getMastodonSession();
			if (session) { this.mastodonAccount = session.account; this.settings.mastodonServer = session.server; }
		} catch { this.mastodonError = t('mastodonSessionExpired'); }
		this.settingsTab = new SubstackSettingTab(this.app, this);
		await installDevelopment(this);
		this.addSettingTab(this.settingsTab);
		this.register(() => { this.cancelConnection(); this.cancelMastodonLogin(); });
		this.registerObsidianProtocolHandler('to-substack-mastodon', params => { void this.finishMastodonLogin(params); });
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const selection = view?.file?.path === file.path ? view.editor.getSelection() || undefined : undefined;
			menu.addItem(item => item.setTitle(t('pluginName')).setIcon('to-substack')
				.onClick(() => { new PostModal(this, file, selection).open(); }));
		}));
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
			if (!info.file || info.file.extension !== 'md') return;
			const file = info.file;
			const selection = editor.getSelection() || undefined;
			menu.addItem(item => item.setTitle(t('pluginName')).setIcon('to-substack')
				.onClick(() => { new PostModal(this, file, selection).open(); }));
		}));
		if (this.settings.sessionSecretId && this.app.secretStorage.getSecret(this.settings.sessionSecretId)) {
			void this.connect(false);
		}
	}

	cancelMastodonLogin(): void {
		this.mastodonOperation++;
		this.mastodonLogin = null;
		this.mastodonBusy = false;
		this.mastodonError = '';
	}

	async connectMastodon(): Promise<void> {
		if (this.mastodonBusy) return;
		if (this.mastodonLogin && Date.now() - this.mastodonLogin.createdAt < 10 * 60 * 1000) {
			window.open(this.mastodonLogin.authorizationUrl, '_blank', 'noopener');
			return;
		}
		this.cancelMastodonLogin();
		const operation = this.mastodonOperation;
		this.mastodonBusy = true;
		this.settingsTab.update();
		try {
			const redirectUri = `obsidian://to-substack-mastodon?vault=${encodeURIComponent(this.app.vault.getName())}`;
			const login = await beginMastodonLogin(this.settings.mastodonServer, redirectUri);
			if (operation !== this.mastodonOperation) return;
			this.mastodonLogin = login;
			window.open(login.authorizationUrl, '_blank', 'noopener');
		} catch (error) {
			if (operation === this.mastodonOperation) this.mastodonError = error instanceof MastodonError ? error.message : t('mastodonConnectionFailed');
		} finally {
			if (operation === this.mastodonOperation) { this.mastodonBusy = false; this.settingsTab.update(); }
		}
	}

	private async finishMastodonLogin(params: Record<string, string>): Promise<void> {
		const login = this.mastodonLogin;
		if (!login || params.state !== login.state) return;
		this.mastodonLogin = null;
		const operation = this.mastodonOperation;
		this.mastodonBusy = true;
		this.settingsTab.update();
		try {
			const session = await completeMastodonLogin(login, params);
			if (operation !== this.mastodonOperation) { await revokeMastodonSession(session).catch(() => {}); return; }
			const previousSecret = this.app.secretStorage.getSecret(MASTODON_SECRET);
			try {
				this.app.secretStorage.setSecret(MASTODON_SECRET, JSON.stringify(session));
				await this.saveData({ ...this.settings, mastodonServer: session.server, mastodonSecretId: MASTODON_SECRET });
			} catch {
				await revokeMastodonSession(session).catch(() => {});
				this.app.secretStorage.setSecret(MASTODON_SECRET, previousSecret ?? '');
				throw new MastodonError(t('mastodonSaveFailed'));
			}
			if (operation !== this.mastodonOperation) return;
			this.settings.mastodonServer = session.server;
			this.settings.mastodonSecretId = MASTODON_SECRET;
			this.mastodonAccount = session.account;
			this.mastodonError = '';
			new Notice(t('mastodonConnected', { account: session.account }));
		} catch (error) {
			if (operation === this.mastodonOperation) this.mastodonError = error instanceof MastodonError ? error.message : t('mastodonConnectionFailed');
		} finally {
			if (operation === this.mastodonOperation) { this.mastodonBusy = false; this.settingsTab.update(); }
		}
	}

	async disconnectMastodon(): Promise<void> {
		if (this.mastodonBusy) return;
		this.cancelMastodonLogin();
		this.mastodonBusy = true;
		this.settingsTab.update();
		try {
			let session: MastodonSession | null = null;
			try { session = this.getMastodonSession(); } catch { /* An invalid local session can still be removed. */ }
			const ownSecret = this.settings.mastodonSecretId === MASTODON_SECRET;
			await this.saveData({ ...this.settings, mastodonSecretId: '' });
			this.settings.mastodonSecretId = '';
			this.mastodonAccount = '';
			if (ownSecret) {
				try { this.app.secretStorage.setSecret(MASTODON_SECRET, ''); }
				catch { this.mastodonError = t('mastodonSaveFailed'); }
			}
			if (session && ownSecret) {
				try { await revokeMastodonSession(session); }
				catch { this.mastodonError = t('mastodonRevokeFailed'); }
			}
		} catch { this.mastodonError = t('mastodonSaveFailed'); }
		finally { this.mastodonBusy = false; this.settingsTab.update(); }
	}

	cancelConnection(): void {
		this.operation++;
		this.login.close();
		this.activity = '';
		this.account = null;
		this.error = '';
	}

	connect(useBrowser: boolean): Promise<void> {
		if (this.busy) {
			if (useBrowser) this.login.focus();
			return this.connection;
		}
		this.connection = this.loadAccount(useBrowser);
		return this.connection;
	}

	private async loadAccount(useBrowser: boolean): Promise<void> {
		const operation = ++this.operation;
		this.activity = useBrowser ? t('signingIn') : t('loadingNewsletters');
		this.error = '';
		this.settingsTab.update();
		try {
			let session: string;
			let account: SubstackAccount;
			if (useBrowser) {
				const connection = this.login.open();
				this.settingsTab.update();
				const result = await connection;
				if (operation !== this.operation) return;
				if (!result) {
					this.error = t('connectionInterrupted');
					return;
				}
				({ session, account } = result);
			} else {
				const savedSession = this.settings.sessionSecretId ? this.app.secretStorage.getSecret(this.settings.sessionSecretId) : null;
				if (!savedSession) throw new SubstackError(t('chooseSession'));
				session = savedSession;
				account = await getAccount(session);
			}
			if (operation !== this.operation) return;
			if (useBrowser) {
				const previousSecret = this.app.secretStorage.getSecret(SESSION_SECRET);
				const previousId = this.settings.sessionSecretId;
				try {
					this.app.secretStorage.setSecret(SESSION_SECRET, session);
					await this.saveData({ ...this.settings, sessionSecretId: SESSION_SECRET });
					this.settings.sessionSecretId = SESSION_SECRET;
				} catch {
					this.app.secretStorage.setSecret(SESSION_SECRET, previousSecret ?? '');
					this.settings.sessionSecretId = previousId;
					throw new SubstackError(t('sessionSaveFailed'));
				}
			}
			if (operation === this.operation) {
				this.account = account;
				if (useBrowser) new Notice(t('connectionEstablished'));
			}
		} catch (error) {
			if (operation !== this.operation) return;
			this.account = null;
			this.error = error instanceof SubstackError ? error.message : t('connectionFailed');
			new Notice(this.error);
		} finally {
			if (operation === this.operation) {
				this.activity = '';
				this.settingsTab.update();
			}
		}
	}

	async disconnect(): Promise<void> {
		if (this.busy) return;
		this.activity = t('disconnecting');
		this.settingsTab.update();
		try {
			await this.saveData({ ...this.settings, sessionSecretId: '' });
			if (this.settings.sessionSecretId === SESSION_SECRET) this.app.secretStorage.setSecret(SESSION_SECRET, '');
			this.settings.sessionSecretId = '';
			this.cancelConnection();
		} catch {
			this.error = t('disconnectFailed');
		} finally {
			this.activity = '';
		}
		this.settingsTab.update();
	}
}
