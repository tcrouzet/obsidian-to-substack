import {App,arrayBufferToBase64,getLinkpath,requestUrl,TFile} from 'obsidian';
import {t} from './i18n';
import {SubstackError} from './substack';

async function resizeImage(data: string): Promise<string> {
 try {
  const image=createEl('img');
  image.src=data;
  await image.decode();
  if(!image.naturalWidth || !image.naturalHeight)throw new Error();
  if(image.naturalWidth<=1600)return data;
  const canvas=createEl('canvas');
  canvas.width=1600;
  canvas.height=Math.max(1,Math.round(image.naturalHeight*1600/image.naturalWidth));
  const context=canvas.getContext('2d');
  if(!context)throw new Error();
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const mime=data.match(/^data:(image\/(?:jpeg|webp));/i)?.[1].toLowerCase() || 'image/png';
  return canvas.toDataURL(mime,0.9);
 }catch{throw new SubstackError(t('imageEmbedFailed'));}
}

export async function encodeRemoteImage(link: string): Promise<string> {
 if (/^data:image\//i.test(link)) return resizeImage(link);
 try {
  const url=new URL(link);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password)throw new Error();
  const response=await requestUrl({url:url.href,method:'GET',throw:false});
  const mime=Object.entries(response.headers).find(([name])=>name.toLowerCase()==='content-type')?.[1].split(';')[0].trim().toLowerCase() || '';
  if(response.status<200 || response.status>=300 || !/^image\/[a-z0-9.+-]+$/.test(mime) || !response.arrayBuffer.byteLength)throw new Error();
  return await resizeImage('data:'+mime+';base64,'+arrayBufferToBase64(response.arrayBuffer));
 }catch{throw new SubstackError(t('imageEmbedFailed'));}
}

export async function encodeImages(app: App, file: TFile, container: HTMLElement): Promise<void> {
	const encoded = new Map<string, string>();
	const encode = async (link: string): Promise<string> => {
		if (/^data:image\//i.test(link)) {
			let data=encoded.get(link);
			if(!data){data=await resizeImage(link);encoded.set(link,data);encoded.set(data,data);}
			return data;
		}
		if (/^https?:\/\//i.test(link)) {
			let data = encoded.get(link);
			if (!data) {
				data = await encodeRemoteImage(link);
				encoded.set(link, data);
				encoded.set(data, data);
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
			data = await resizeImage(`data:${mime};base64,${arrayBufferToBase64(await app.vault.readBinary(attachment))}`);
			encoded.set(attachment.path, data);
			encoded.set(data, data);
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
