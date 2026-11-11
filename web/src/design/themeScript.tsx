import {
  CONTRASTS,
  DEFAULT_THEME,
  DENSITIES,
  LEGACY_PALETTES,
  PALETTES,
  PALETTE_CSS_VARIABLES,
  SCHEMES,
  SIZES,
  THEME_STORAGE_KEY,
} from "@/design/themes";

const ids = (list: readonly { id: string }[]) => list.map(({ id }) => id);

/**
 * Runs before paint, so the first frame is already in the user's theme. Without
 * it a light-scheme user sees one dark frame on every navigation.
 *
 * It repeats the narrowing in `themes.ts` instead of importing it, because an
 * import would pull the whole module into a blocking inline script. Everything
 * it needs to decide is injected from that module as data, so the two cannot
 * disagree about what is valid or what the defaults are, and the script only
 * has to be kept in step with `applyThemeAttributes` in how it writes them.
 */
const script = `(function(){
var DEFAULT=${JSON.stringify(DEFAULT_THEME)},VARIABLES=${JSON.stringify(PALETTE_CSS_VARIABLES)};
var LEGACY_PALETTES=${JSON.stringify(LEGACY_PALETTES)};
var PALETTES=${JSON.stringify(ids(PALETTES))},SIZES=${JSON.stringify(ids(SIZES))},DENSITIES=${JSON.stringify(ids(DENSITIES))};
var SCHEMES=${JSON.stringify(SCHEMES)},CONTRASTS=${JSON.stringify(CONTRASTS)};
var saved=null;
try{var raw=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(raw)saved=JSON.parse(raw)}catch(e){}
function pick(key,allowed,legacy){
var value=saved&&saved[key];
if(legacy&&typeof value==="string"&&legacy.hasOwnProperty(value))value=legacy[value];
return allowed.indexOf(value)<0?DEFAULT[key]:value;
}
var palette=pick("palette",PALETTES,LEGACY_PALETTES),variables=Object.assign({},VARIABLES[palette]),accent=saved&&saved.accent;
if(typeof accent==="string"&&/^#[\\da-f]{6}$/i.test(accent)){
accent=accent.toLowerCase();
var c=[1,3,5].map(function(i){var n=parseInt(accent.slice(i,i+2),16)/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)});
var l=.2126*c[0]+.7152*c[1]+.0722*c[2];
variables["--palette-accent"]=accent;
variables["--palette-on-accent"]=(l+.05)/.05>=1.05/(l+.05)?"#000000":"#ffffff";
}
var root=document.documentElement,scheme=pick("scheme",SCHEMES);
Object.keys(variables).forEach(function(name){root.style.setProperty(name,variables[name])});
if(scheme==="system")scheme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
root.dataset.theme=palette;
root.dataset.scheme=scheme;
root.dataset.contrast=pick("contrast",CONTRASTS);
root.dataset.size=pick("size",SIZES);
root.dataset.density=pick("density",DENSITIES);
})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
