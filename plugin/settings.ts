import { draftLanguageName, t } from './i18n';
import { App, Platform, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type ToSubstackPlugin from './main';
import { DRAFT_LANGUAGES } from './substack';

export class SubstackSettingTab extends PluginSettingTab {
	override icon = 'to-substack';
	plugin: ToSubstackPlugin;

	constructor(app: App, plugin: ToSubstackPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'sessionSecretId') this.plugin.cancelConnection();
		await super.setControlValue(key, value);
		this.update();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const plugin = this.plugin;
		return [
			{
				type: 'group',
				heading: t('substackAccount'),
				items: [
					{
						name: plugin.activity || (plugin.account ? t('connectedToAccount', { account: plugin.account.name }) : t('notConnected')),
						desc: plugin.error || (plugin.hasLoginWindow ? t('emailCodeHelp') : plugin.busy ? t('loadingAccountHelp') : t('connectionHelp')),
						render: setting => {
							setting.descEl.setAttribute('role', plugin.error ? 'alert' : 'status');
							if (Platform.isDesktopApp) setting.addButton(button => button
								.setButtonText(plugin.hasLoginWindow ? t('returnToSignIn') : plugin.account ? t('switchAccount') : t('signIn'))
								.setCta().setDisabled(plugin.busy && !plugin.hasLoginWindow)
								.onClick(() => { void plugin.connect(true); }));
							setting.addButton(button => button.setButtonText(t('refresh'))
								.setDisabled(plugin.busy || !plugin.settings.sessionSecretId)
								.onClick(() => { void plugin.connect(false); }));
							if (plugin.busy) setting.addButton(button => button.setButtonText(t('cancel'))
								.onClick(() => { plugin.cancelConnection(); this.update(); }));
							if (plugin.settings.sessionSecretId) setting.addButton(button => button
								.setButtonText(t('disconnect')).setDisabled(plugin.busy)
								.onClick(() => { void plugin.disconnect(); }));
						}
					}
				]
			},
			{
				type: 'group',
				heading: t('newsletters'),
				items: plugin.account?.newsletters.length ? plugin.account.newsletters.map(newsletter => ({
					name: newsletter.name,
					desc: `https://${newsletter.subdomain}.substack.com`
				})) : [{
					name: plugin.account ? t('noNewsletters') : t('connectToLoadNewsletters'),
					desc: plugin.account ? t('checkAccountAccess') : ''
				}]
			},
			{
				type: 'group',
				heading: t('languageEditions'),
				items: DRAFT_LANGUAGES.map(language => {
					const name = draftLanguageName(language);
					return {
						name: name.charAt(0).toUpperCase() + name.slice(1),
						desc: language === 'fr' ? t('frenchEditionHelp') : '',
						render: setting => { setting.addToggle(toggle => toggle
							.setValue(plugin.settings.translationLanguages.includes(language))
							.setDisabled(plugin.busy)
							.onChange(async enabled => {
								const selected = DRAFT_LANGUAGES.filter(candidate => candidate === language ? enabled : plugin.settings.translationLanguages.includes(candidate));
								await this.setControlValue('translationLanguages', selected);
							})); }
					};
				})
			},
			{
				type: 'group',
				heading: t('manualConnection'),
				items: [{
					name: t('substackSession'),
					desc: t('manualSessionHelp'),
					control: { type: 'secret', key: 'sessionSecretId', disabled: () => plugin.busy }
				}]
			}
		];
	}
}
