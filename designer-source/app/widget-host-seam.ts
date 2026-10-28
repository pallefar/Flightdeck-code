// Explicit sandbox seams. Only StatTile's two host imports are redirected here.
// The full OS i18n and navigation modules are intentionally NOT imported.
export function t(key:string):string {if(key==='widget.sourceFailed')return 'Sample source unavailable';throw Error('Unsupported sample translation');}
export function navigate(_path:string):never {throw Error('Navigation is unavailable in the local design sandbox');}
