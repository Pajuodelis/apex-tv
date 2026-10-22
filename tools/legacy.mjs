// Tizen 5.0 (2019 Samsung TVs) runs Chromium 63; Tizen 5.5 uses Chromium 69, i.e. ES2017 plus object spread.
// Every JS/CSS file that reaches the TV goes through this step so newer syntax
// (optional chaining, ??, optional catch binding, class fields, logical
// assignment, CSS `inset`, nesting, ...) is lowered before it is signed.
// Runtime APIs (matchAll, AbortController, ...) are covered by tv/legacy-polyfills.js.
export const TIZEN_TARGET = 'chrome63';

let esbuild;
async function load() {
  if (esbuild) return esbuild;
  try { esbuild = await import('esbuild'); }
  catch (error) {
    throw Error('esbuild is required to build for Tizen 5.5. Run "npm install" in the project folder first. (' + error.message + ')');
  }
  return esbuild;
}

export async function lowerJS(source, name = 'tv-app.js') {
  const { transform } = await load();
  const result = await transform(Buffer.isBuffer(source) ? source.toString('utf8') : String(source), {
    loader: 'js', target: TIZEN_TARGET, charset: 'utf8', legalComments: 'inline',
    // esbuild refuses syntax it cannot lower (e.g. BigInt literals), so the build fails instead of shipping a black screen.
    minifyWhitespace: true, sourcefile: name, logLevel: 'silent'
  });
  return Buffer.from(result.code, 'utf8');
}

export async function lowerCSS(source, name = 'tv.css') {
  const { transform } = await load();
  const result = await transform(Buffer.isBuffer(source) ? source.toString('utf8') : String(source), {
    loader: 'css', target: TIZEN_TARGET, charset: 'utf8', legalComments: 'inline', minifyWhitespace: true, sourcefile: name, logLevel: 'silent'
  });
  return Buffer.from(result.code, 'utf8');
}
