// api/_premium.js — vérification des codes Premium (fichier interne, non exposé comme route par Vercel).
// Les codes ne sont jamais stockés en clair : seule leur empreinte SHA-256 est dans la variable PREMIUM_CODES.
// Format de PREMIUM_CODES : "empreinte:AAAA-MM-JJ,empreinte:AAAA-MM-JJ,..." (la date = dernier jour de validité).
const crypto = require('crypto');

function normaliser(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function empreinte(code) { return crypto.createHash('sha256').update(normaliser(code)).digest('hex'); }

function charger() {
    const m = new Map();
    String(process.env.PREMIUM_CODES || '').split(/[\s,;]+/).forEach((e) => {
        const [h, d] = e.split(':');
        if (/^[0-9a-f]{64}$/.test(h || '') && /^\d{4}-\d{2}-\d{2}$/.test(d || '')) m.set(h, d);
    });
    return m;
}

// Retourne { valide, raison?, expire? }
function verifier(code) {
    if (normaliser(code).length !== 16) return { valide: false, raison: 'format' };
    const expire = charger().get(empreinte(code));
    if (!expire) return { valide: false, raison: 'inconnu' };
    if (new Date().toISOString().slice(0, 10) > expire) return { valide: false, raison: 'expire', expire };
    return { valide: true, expire };
}

module.exports = { verifier, normaliser };
