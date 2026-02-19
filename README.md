# DAX40 API — Dukascopy → JSON

Micro-API serverless sur Vercel qui fetch les données M1 du DAX depuis Dukascopy
et les retourne en JSON. Appelée par n8n Cloud.

## Déploiement (5 minutes)

### Option A : Via GitHub (recommandé — auto-deploy)

1. **Créer un repo GitHub** : aller sur github.com → New repository → nommer `dax-api` → Private
2. **Uploader les 3 fichiers** : `package.json`, `vercel.json`, `api/dax.js`
3. **Dans Vercel** : Import Project → choisir le repo `dax-api` → Deploy
4. **Ajouter la variable d'environnement** (optionnel mais recommandé) :
   - Vercel → Settings → Environment Variables
   - Name: `DAX_API_KEY`
   - Value: un mot de passe au choix (ex: `dax2026secret`)
5. **Tester** : `https://ton-projet.vercel.app/api/dax?ping=true`

### Option B : Via CLI

```bash
npm install -g vercel
cd dax-api
vercel
# Suivre les instructions
# Ajouter la variable: vercel env add DAX_API_KEY
vercel --prod
```

## Endpoints

### Health check
```
GET /api/dax?ping=true
```

### Bougies M1 d'une journée (pour le batch soir)
```
GET /api/dax?date=2026-02-19&key=dax2026secret
```
Retourne ~480 bougies M1 (08:00-16:00 UTC).

### Bougies M5
```
GET /api/dax?date=2026-02-19&tf=m5&key=dax2026secret
```

### Prix live (pour le workflow intraday)
```
GET /api/dax?live=true&key=dax2026secret
```
Retourne la dernière bougie M1 disponible.

## Utilisation dans n8n

### HTTP Request node (batch soir)
- **Method**: GET
- **URL**: `https://ton-projet.vercel.app/api/dax?date={{ $json.today }}`
- **Headers**: `x-api-key: dax2026secret`

### HTTP Request node (live)
- **Method**: GET
- **URL**: `https://ton-projet.vercel.app/api/dax?live=true`
- **Headers**: `x-api-key: dax2026secret`

## Limites Vercel gratuit
- 100 000 appels/mois (on utilise ~450/jour = ~13 500/mois → OK)
- 10 secondes max par appel (le fetch M1 prend ~3-5 sec → OK)
- 256 MB RAM (largement suffisant)

## Format de réponse (batch)

```json
{
  "status": "ok",
  "date": "2026-02-19",
  "timeframe": "m1",
  "n_candles": 480,
  "summary": {
    "open": 22450.3,
    "high": 22520.1,
    "low": 22410.5,
    "close": 22498.7,
    "range": 109.6
  },
  "candles": [
    {
      "timestamp": "2026-02-19T08:00:00.000Z",
      "hour": 8,
      "minute": 0,
      "open": 22450.3,
      "high": 22452.1,
      "low": 22448.9,
      "close": 22451.5,
      "volume": 234.5
    },
    ...
  ]
}
```
