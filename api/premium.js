// api/premium.js — vérifie un code Premium. POST { code } -> { valide: true, expire } ou erreur.
const { verifier } = require('./_premium');

const essais = new Map(); // anti-devinette : 10 essais par minute et par visiteur (mémoire de l'instance)
function limite(visiteur) {
    const now = Date.now();
    const t = (essais.get(visiteur) || []).filter((x) => now - x < 60000);
    if (t.length >= 10) return true;
    t.push(now); essais.set(visiteur, t);
    if (essais.size > 5000) essais.clear();
    return false;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) {
            return res.status(403).json({ error: 'Origine non autorisée.' });
        }
    } catch (e) { return res.status(403).json({ error: 'Origine non autorisée.' }); }

    const visiteur = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'inconnu').split(',')[0].trim();
    if (limite(visiteur)) return res.status(429).json({ error: 'Trop d\'essais. Réessayez dans une minute.' });

    const code = req.body && typeof req.body.code === 'string' ? req.body.code.slice(0, 40) : '';
    const r = verifier(code);
    if (r.valide) return res.status(200).json({ valide: true, expire: r.expire });
    const msg = r.raison === 'expire' ? 'Ce code a expiré (valide jusqu\'au ' + r.expire + ').'
        : r.raison === 'format' ? 'Le code doit avoir 16 caractères (ex. ABCD-EFGH-JKLM-NPQR).'
        : 'Code inconnu. Vérifiez la saisie.';
    return res.status(401).json({ valide: false, error: msg });
};
