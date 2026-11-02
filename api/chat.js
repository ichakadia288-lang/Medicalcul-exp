// api/chat.js — fonction serverless Vercel pour l'assistant de MediCalcul Express (Google Gemini, offre gratuite).
// La clé reste côté serveur (variable d'environnement GEMINI_API_KEY).

const TYPES_AUTORISES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

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

    // Refuse les appels venant d'un autre site
    const origin = req.headers.origin;
    if (origin) {
        try {
            if (new URL(origin).host !== req.headers.host) {
                return res.status(403).json({ error: 'Origine non autorisée.' });
            }
        } catch (e) {
            return res.status(403).json({ error: 'Origine non autorisée.' });
        }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "L'assistant n'est pas configuré (clé GEMINI_API_KEY manquante sur le serveur)." });
    }

    const { message, file, lang } = req.body || {};
    const texte = typeof message === 'string' ? message.trim().slice(0, 2000) : '';
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
                systemInstruction: { parts: [{ text: SYSTEM_FR + (lang === 'en' ? '\nThe user interface is in English: answer in English.' : '') }] },
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
