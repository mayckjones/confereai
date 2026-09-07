const fs = require('fs');
const path = require('path');

const imgPath = path.join(__dirname, 'farmacia_logo.jpg');
const buf = fs.readFileSync(imgPath);
const b64 = buf.toString('base64');
const out = 'window.FARMACIA_LOGO_BASE64 = ' + JSON.stringify(b64) + ';\n';
fs.writeFileSync(path.join(__dirname, 'logo_base64.js'), out);
console.log('Successfully created logo_base64.js with length:', b64.length);
