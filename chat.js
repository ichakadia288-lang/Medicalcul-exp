// api/chat.js — fonction serverless Vercel pour l'assistant de MediCalcul Express (Google Gemini, offre gratuite).
// La clé reste côté serveur (variable d'environnement GEMINI_API_KEY).

const TYPES_AUTORISES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

// ---- Limites d'utilisation (protègent le quota et le budget) ----
// Réglables sans modifier le code, via les variables d'environnement Vercel.
const LIMITE_MINUTE = parseInt(process.env.LIMIT_PER_MINUTE, 10) || 5;     // par visiteur
const LIMITE_HEURE = parseInt(process.env.LIMIT_PER_HOUR, 10) || 30;       // par visiteur
const LIMITE_JOUR_GLOBALE = parseInt(process.env.LIMIT_PER_DAY_GLOBAL, 10) || 500; // tous visiteurs confondus
const MAX_VISITEURS_SUIVIS = 5000;

// Mémoire de l'instance serveur : suffisant pour freiner les abus, mais pas infaillible
// (chaque instance serverless a sa propre mémoire). Pour une limite stricte, utilisez Upstash Redis.
const appelsParVisiteur = new Map();
let jourCourant = new Date().toISOString().slice(0, 10);
let compteurJour = 0;

function identifierVisiteur(req) {
    const brut = req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'inconnu';
    return String(brut).split(',')[0].trim();
}

// Retourne 0 si l'appel est autorisé, sinon le nombre de secondes à attendre.
function verifierLimites(visiteur) {
    const maintenant = Date.now();
    const aujourdhui = new Date(maintenant).toISOString().slice(0, 10);
    if (aujourdhui !== jourCourant) { jourCourant = aujourdhui; compteurJour = 0; }
    if (compteurJour >= LIMITE_JOUR_GLOBALE) return 3600;

    if (appelsParVisiteur.size > MAX_VISITEURS_SUIVIS) {
        for (const [cle, temps] of appelsParVisiteur) {
            if (!temps.length || maintenant - temps[temps.length - 1] > 3600000) appelsParVisiteur.delete(cle);
        }
        if (appelsParVisiteur.size > MAX_VISITEURS_SUIVIS) appelsParVisiteur.clear();
    }

    const temps = (appelsParVisiteur.get(visiteur) || []).filter((t) => maintenant - t < 3600000);
    const derniereMinute = temps.filter((t) => maintenant - t < 60000);
    if (derniereMinute.length >= LIMITE_MINUTE) {
        return Math.max(1, Math.ceil((60000 - (maintenant - derniereMinute[0])) / 1000));
    }
    if (temps.length >= LIMITE_HEURE) {
        return Math.max(1, Math.ceil((3600000 - (maintenant - temps[0])) / 1000));
    }
    temps.push(maintenant);
    appelsParVisiteur.set(visiteur, temps);
    compteurJour++;
    return 0;
}

const LANGUES = { en: 'English', ar: 'Arabic', ru: 'Russian', de: 'German' };

const SYSTEM_FR = `Tu es l'assistant de MediCalcul Express, une application destinée aux étudiants et aux professionnels de santé.
- Réponds dans la langue de l'utilisateur, de façon claire et concise (environ 150 mots maximum, lisible sur téléphone).
- Pour une image ou un document (bilan biologique, radio, ECG, ordonnance...) : décris ce que tu observes, signale les valeurs ou éléments notables et les points à vérifier. Tu ne poses pas de diagnostic définitif et tu précises que l'interprétation finale revient à un professionnel de santé qualifié.
- Ne donne jamais une dose à administrer à un patient précis comme une consigne : renvoie au protocole local, au RCP du médicament ou à la prescription médicale.
- Si la situation évoque une urgence vitale, recommande d'appeler immédiatement les secours.
- Si tu n'es pas sûr, dis-le.`;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée.' });
    }

    res.setHeader('Cache-Control', 'no-store');

    // Refuse les appels venant d'un autre site, ou sans origine (un navigateur en envoie toujours une pour un POST)
    const origin = req.headers.origin;
    if (!origin) {
        return res.status(403).json({ error: 'Origine non autorisée.' });
    }
    try {
        if (new URL(origin).host !== req.headers.host) {
            return res.status(403).json({ error: 'Origine non autorisée.' });
        }
    } catch (e) {
        return res.status(403).json({ error: 'Origine non autorisée.' });
    }

    // Limitation du nombre d'appels (avant tout appel payant à Gemini)
    const attente = verifierLimites(identifierVisiteur(req));
    if (attente > 0) {
        res.setHeader('Retry-After', String(attente));
        return res.status(429).json({ error: 'Trop de demandes. Réessayez dans ' + (attente > 90 ? Math.ceil(attente / 60) + ' minutes.' : attente + ' secondes.') });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "L'assistant n'est pas configuré (clé GEMINI_API_KEY manquante sur le serveur)." });
    }

    const { message, file, lang } = req.body || {};
    const texte = typeof message === 'string' ? message.trim().slice(0, 1000) : '';
    if (!texte && !file) {
        return res.status(400).json({ error: 'Message vide.' });
    }

    const parts = [];
    if (file) {
        if (!TYPES_AUTORISES.includes(file.media_type) || typeof file.data !== 'string' || file.data.length > 4000000) {
            return res.status(400).json({ error: 'Fichier non pris en charge ou trop volumineux.' });
        }
        parts.push({ inline_data: { mime_type: file.media_type, data: file.data } });
    }
    parts.push({ text: texte || 'Analyse ce document médical.' });

    const modele = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modele)}:generateContent`;

    try {
        const reponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_FR + (LANGUES[lang] && lang !== 'fr' ? '\nThe user interface is in ' + LANGUES[lang] + ': answer in ' + LANGUES[lang] + '.' : '') }] },
                contents: [{ role: 'user', parts }],
                generationConfig: { maxOutputTokens: 800, temperature: 0.4 }
            })
        });

        const data = await reponse.json().catch(() => ({}));
        if (!reponse.ok) {
            console.error('Erreur API Gemini', reponse.status, JSON.stringify(data));
            const quota = reponse.status === 429;
            return res.status(502).json({
                error: quota
                    ? "Limite gratuite atteinte pour le moment. Réessayez dans quelques minutes."
                    : "L'assistant est momentanément indisponible."
            });
        }

        const candidat = (data.candidates || [])[0];
        const reply = ((candidat && candidat.content && candidat.content.parts) || [])
            .map((p) => p.text || '').join('\n').trim();
        if (!reply) {
            return res.status(200).json({ reply: "Je n'ai pas pu générer de réponse pour cette demande. Reformulez ou changez de fichier." });
        }
        return res.status(200).json({ reply });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Erreur serveur. Réessayez dans un instant." });
    }
};