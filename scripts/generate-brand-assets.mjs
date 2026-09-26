import fs from 'node:fs';
import path from 'node:path';

// Match app/static/styles.css. The website does not load a separate Inter font.
const sans = 'Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
const dir = path.resolve('app/static/images');
const icons = "  <path d=\"M950 80H1120\" stroke=\"#b7a3ff\" stroke-opacity=\".4\" stroke-width=\"2\"/>\n  <g fill=\"#211e22\" stroke=\"#302d32\">\n    <rect x=\"920\" y=\"52\" width=\"56\" height=\"56\" rx=\"12\"/>\n    <rect x=\"1008\" y=\"52\" width=\"56\" height=\"56\" rx=\"12\"/>\n    <rect x=\"1096\" y=\"52\" width=\"56\" height=\"56\" rx=\"12\"/>\n  </g>\n  <g fill=\"none\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <g transform=\"translate(932 64) scale(1.333)\" stroke=\"#b7a3ff\">\n      <circle cx=\"12\" cy=\"7\" r=\"3\"/>\n      <path d=\"M6.5 21v-3a5.5 5.5 0 0 1 11 0v3M6.5 9a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 1 1 4.5 0ZM22 9a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 1 1 4.5 0ZM1 20v-3a3.25 3.25 0 0 1 3.25-3.25M23 20v-3a3.25 3.25 0 0 0-3.25-3.25\"/>\n    </g>\n    <g transform=\"translate(1020 64) scale(1.333)\" stroke=\"#d9f96e\">\n      <path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6\"/>\n    </g>\n    <g transform=\"translate(1108 64) scale(1.333)\" stroke=\"#d9f96e\">\n      <path d=\"M12 5c-1-5-7-3-7 1-4 0-5 6-2 8-2 4 1 7 4 6 1 3 5 2 5-1V5ZM12 5c1-5 7-3 7 1 4 0 5 6 2 8 2 4-1 7-4 6-1 3-5 2-5-1M5 6l2 2M3 14h3M7 20v-3M19 6l-2 2M21 14h-3M17 20v-3\"/>\n    </g>\n  </g>\n";
function background(w, h, radius) {
  return `<defs>
    <radialGradient id="upper"><stop stop-color="#584070" stop-opacity=".42"/><stop offset="1" stop-color="#584070" stop-opacity="0"/></radialGradient>
    <radialGradient id="lower"><stop stop-color="#654181" stop-opacity=".34"/><stop offset="1" stop-color="#654181" stop-opacity="0"/></radialGradient>
    <radialGradient id="left"><stop stop-color="#463250" stop-opacity=".24"/><stop offset="1" stop-color="#463250" stop-opacity="0"/></radialGradient>
    <clipPath id="bounds"><rect width="${w}" height="${h}" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#bounds)"><rect width="${w}" height="${h}" fill="#151316"/>
    <ellipse cx="${w*.79}" cy="${h*.05}" rx="${w*.3}" ry="${h*.9}" fill="url(#upper)"/>
    <ellipse cx="${w*.99}" cy="${h*1.06}" rx="${w*.32}" ry="${h*.72}" fill="url(#lower)"/>
    <ellipse cx="${w*.27}" cy="${h*.88}" rx="${w*.23}" ry="${h*.8}" fill="url(#left)"/>
  </g>`;
}
function logo(x,y,scale) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <rect width="25" height="25" rx="8" fill="#d9f96e"/>
    <text x="12.5" y="18.5" text-anchor="middle" font-family="Georgia,serif" font-size="20" font-weight="800" fill="#273000">r</text>
    <text x="34" y="19.5" font-family="${sans}" font-size="20" font-weight="750" letter-spacing="-.7" fill="#f7f5f2">relay</text>
  </g>`;
}
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="160" viewBox="0 0 1200 160" role="img" aria-labelledby="title desc">
  <title id="title">Relay</title><desc id="desc">Shared memory. Standardized tools. Connected team, document and brain icons.</desc>
  ${background(1200,160,16)}
  ${logo(48,48,2.56)}
  <path d="M300 58V102" stroke="#39313e"/>
  <text x="332" y="88" font-family="${sans}" font-size="24" fill="#a9a4ab">Shared memory. Standardized tools.</text>
${icons}</svg>\n`;
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-labelledby="title desc">
  <title id="title">Relay — your team's shared AI workspace</title><desc id="desc">Shared memory. Standardized tools.</desc>
  ${background(1280,640,0)}
  ${logo(80,100,4.8)}
  <g transform="translate(-418 36) scale(1.4)">${icons}</g>
  <g font-family="${sans}">
    <text x="80" y="346" font-size="48" fill="#f7f5f2">Shared memory.</text>
    <text x="80" y="406" font-size="48" fill="#f7f5f2">Standardized tools.</text>
    <path d="M80 486H1200" stroke="#39313e"/>
    <text x="80" y="547" font-size="23" fill="#a9a4ab">Your team's shared AI workspace</text>
  </g>
</svg>\n`;
const demo = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200" viewBox="0 0 1200 200">
  ${background(1200,200,16)}
  ${logo(48,68,2.56)}
  <path d="M300 58V142" stroke="#39313e"/>
  <g font-family="${sans}">
    <text x="336" y="91" font-size="30" font-weight="750" fill="#f7f5f2">See Relay in action</text>
    <text x="336" y="126" font-size="20" fill="#a9a4ab">Private chats. Shared knowledge. One team.</text>
    <rect x="910" y="70" width="242" height="60" rx="14" fill="#d9f96e"/>
    <path d="M934 88L934 112L953 100Z" fill="#273000"/>
    <text x="969" y="108" font-size="22" font-weight="700" fill="#273000">Watch demo</text>
  </g>
</svg>`;
// Export these pages with Chromium's --default-background-color=00000000
// and --force-device-scale-factor=1 so rounded corners remain transparent.
// Use --window-size=1200,160 for banner, 1200,200 for demo, 1280,640 for social.
fs.mkdirSync('tmp/brand-preview',{recursive:true});
fs.writeFileSync('tmp/brand-preview/social.html',`<!doctype html><style>html,body{margin:0;width:1280px;height:640px;overflow:hidden}svg{display:block}</style>${social}`);
fs.writeFileSync('tmp/brand-preview/banner.html',`<!doctype html><style>html,body{margin:0;width:1200px;height:160px;overflow:hidden}svg{display:block}</style>${banner}`);
fs.writeFileSync('tmp/brand-preview/demo.html',`<!doctype html><style>html,body{margin:0;width:1200px;height:200px;overflow:hidden}svg{display:block}</style>${demo}`);
