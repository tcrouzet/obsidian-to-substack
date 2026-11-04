import { t } from './i18n';
import { Platform } from 'obsidian';
import { getAccount, SubstackAccount, SubstackError } from './substack';

interface LoginResult {
	session: string;
	account: SubstackAccount;
}

interface Cookie {
	name: string;
	value: string;
}

interface CookieStore {
	get(filter: { url: string }): Promise<Cookie[]>;
	on(event: 'changed', listener: (event: unknown, cookie: Cookie) => void): void;
	removeListener(event: 'changed', listener: (event: unknown, cookie: Cookie) => void): void;
}

interface LoginWindow {
	webContents: {
		session: {
			cookies: CookieStore;
			webRequest: {
				onBeforeRequest(listener: ((details: { url: string; resourceType: string }, callback: (response: { cancel: boolean }) => void) => void) | null): void;
			};
		};
		on(event: 'did-finish-load' | 'did-navigate-in-page' | 'will-prevent-unload', listener: () => void): void;
		removeAllListeners(event: 'will-navigate'): void;
		setWindowOpenHandler(handler: () => { action: 'deny' }): void;
	};
	on(event: 'closed', listener: () => void): void;
	loadURL(url: string): Promise<void>;
	isDestroyed(): boolean;
	isMinimized(): boolean;
	restore(): void;
	show(): void;
	focus(): void;
	destroy(): void;
}

interface ElectronRemote {
	app: { focus(options: { steal: boolean }): void };
	createFunctionWithReturnValue(value: { action: 'deny' }): () => { action: 'deny' };
	BrowserWindow: {
		new (options: {
			width: number;
			height: number;
			title: string;
			parent?: LoginWindow;
			webPreferences: { partition: string; nodeIntegration: false; contextIsolation: true; sandbox: true };
		}): LoginWindow;
		getFocusedWindow(): LoginWindow | null;
	};
}

export class SubstackLogin {
	private authWindow: LoginWindow | null = null;
	private app?: ElectronRemote['app'];

	get isOpen(): boolean {
		return this.authWindow !== null && !this.authWindow.isDestroyed();
	}

	focus(): void {
		const authWindow = this.authWindow;
		if (!authWindow || authWindow.isDestroyed()) return;
		if (authWindow.isMinimized()) authWindow.restore();
		this.app?.focus({ steal: true });
		authWindow.show();
		authWindow.focus();
	}

	close(): void {
		if (this.authWindow && !this.authWindow.isDestroyed()) this.authWindow.destroy();
	}

	open(): Promise<LoginResult | null> {
		if (!Platform.isDesktopApp) {
			throw new SubstackError(t('mobileSessionRequired'));
		}
		let remote: Partial<ElectronRemote>;
		try {
			const electron = (window.require as (name: string) => unknown)('electron') as Partial<ElectronRemote> & { remote?: ElectronRemote };
			remote = electron.remote ?? electron;
		} catch {
			throw new SubstackError(t('automaticLoginUnavailable'));
		}
		if (!remote.BrowserWindow || !remote.createFunctionWithReturnValue) {
			throw new SubstackError(t('automaticLoginUnavailable'));
		}
		this.app = remote.app;
		const denyPopups = remote.createFunctionWithReturnValue({ action: 'deny' });
		const settingsWindow = remote.BrowserWindow.getFocusedWindow();
		const authWindow = new remote.BrowserWindow({
			width: 520,
			height: 720,
			title: t('loginTitle'),
			parent: settingsWindow ?? undefined,
			webPreferences: {
				partition: `to-substack-login-${Date.now()}`,
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true
			}
		});
		this.authWindow = authWindow;
		return new Promise((resolve, reject) => {
			const { cookies, webRequest } = authWindow.webContents.session;
			// Obsidian sends this window's navigations to the system browser by default.
			authWindow.webContents.removeAllListeners('will-navigate');
			webRequest.onBeforeRequest((details, callback) => {
				let cancel = false;
				if (details.resourceType === 'mainFrame' && details.url !== 'about:blank') {
					try {
						const url = new URL(details.url);
						cancel = url.protocol !== 'https:' || !!url.username || !!url.password || (url.hostname !== 'substack.com' && !url.hostname.endsWith('.substack.com'));
					} catch {
						cancel = true;
					}
				}
				callback({ cancel });
			});
			let finished = false;
			let checking = false;
			const finish = (result: LoginResult | null, error?: SubstackError): void => {
				if (finished) return;
				finished = true;
				clearInterval(interval);
				cookies.removeListener('changed', cookieChanged);
				if (this.authWindow === authWindow) this.authWindow = null;
				// Only the disposable login window is destroyed; the page cannot veto its dismissal.
				if (!authWindow.isDestroyed()) authWindow.destroy();
				webRequest.onBeforeRequest(null);
				if (result && settingsWindow && !settingsWindow.isDestroyed()) {
					if (settingsWindow.isMinimized()) settingsWindow.restore();
					this.app?.focus({ steal: true });
					settingsWindow.show();
					settingsWindow.focus();
				}
				if (error) reject(error);
				else resolve(result);
			};
			const checkCookies = (): void => {
				if (finished || checking) return;
				checking = true;
				void (async () => {
					try {
						const values = await cookies.get({ url: 'https://substack.com' });
						if (finished || !values.some(cookie => cookie.name === 'substack.sid' && cookie.value)) return;
						const session = values.filter(cookie => cookie.name.startsWith('substack') || cookie.name === 'connect.sid')
							.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
						const account = await getAccount(session);
						finish({ session, account });
					} catch (error) {
						// Substack may create a session cookie before the email code has been verified.
						if (error instanceof SubstackError && (error.status === 401 || error.status === 403)) return;
						if (!finished) finish(null, error instanceof SubstackError ? error : new SubstackError(t('sessionReadFailed')));
					} finally {
						checking = false;
					}
				})();
			};
			const cookieChanged = (_event: unknown, cookie: Cookie): void => {
				if (cookie.name === 'substack.sid') checkCookies();
			};
			// Authentication can complete on the server without another cookie or navigation event.
			const interval = setInterval(checkCookies, 2000);
			cookies.on('changed', cookieChanged);
			authWindow.on('closed', () => finish(null));
			authWindow.webContents.on('will-prevent-unload', () => finish(null));
			authWindow.webContents.on('did-finish-load', checkCookies);
			authWindow.webContents.on('did-navigate-in-page', checkCookies);
			authWindow.webContents.setWindowOpenHandler(denyPopups);
			void authWindow.loadURL('https://substack.com/sign-in').catch((error: unknown) => {
				if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'ERR_ABORTED') return;
				finish(null, new SubstackError(t('loginPageFailed')));
			});
		});
	}
}
