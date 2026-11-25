import type ToSubstackPlugin from './main';

export const installDevelopment: (plugin: ToSubstackPlugin) => Promise<void> = () => Promise.resolve();
