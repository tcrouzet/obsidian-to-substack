import { setLocale, t } from './i18n';
import { getLanguage, Notice, Plugin, TFile } from 'obsidian';
import { PostModal } from './post';
import { SubstackLogin } from './auth';
import { SubstackSettingTab } from './settings';
import { getAccount, SubstackAccount, SubstackError } from './substack';

const SESSION_SECRET = 'obsidian-to-substack-session';

export default class ToSubstackPlugin extends Plugin {
	settings = { sessionSecretId: '' };
	account: SubstackAccount | null = null;
	activity = '';
	error = '';
	private operation = 0;
	private login = new SubstackLogin();
	private settingsTab: SubstackSettingTab;

	get busy(): boolean {
		return this.activity !== '';
	}

	get hasLoginWindow(): boolean {
		return this.login.isOpen;
	}

	async onload(): Promise<void> {
		setLocale(getLanguage());
		const saved: unknown = await this.loadData();
		if (saved && typeof saved === 'object' && 'sessionSecretId' in saved) {
			const value: unknown = (saved as Record<string, unknown>).sessionSecretId;
			if (typeof value === 'string' && /^[a-z0-9-]+$/.test(value)) this.settings.sessionSecretId = value;
		}
		this.settingsTab = new SubstackSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);
		this.register(() => this.cancelConnection());
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile && file.extension === 'md') menu.addItem(item => item
				.setTitle(t('pluginName')).setIcon('send').onClick(() => { new PostModal(this, file).open(); }));
		}));
		if (this.settings.sessionSecretId && this.app.secretStorage.getSecret(this.settings.sessionSecretId)) {
			void this.connect(false);
		}
	}

	cancelConnection(): void {
		this.operation++;
		this.login.close();
		this.activity = '';
		this.account = null;
		this.error = '';
	}

	async connect(useBrowser: boolean): Promise<void> {
		if (this.busy) {
			if (useBrowser) this.login.focus();
			return;
		}
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
					await this.saveData({ sessionSecretId: SESSION_SECRET });
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
			await this.saveData({ sessionSecretId: '' });
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
