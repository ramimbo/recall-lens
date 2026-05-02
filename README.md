# Recall Lens

Recall Lens is a small official-recall triage desk for households and caregivers.

It pulls current FDA food enforcement reports and CPSC product recalls, matches them against a short household profile, and writes a plain action list. It is meant for the messy moment when a real recall, a news post, and a scam text all look similar.

## Why This Exists

In 2026, recall information is current and scattered. FDA food alerts continue to update, CPSC publishes serious household product recalls, and scam recall texts are common enough that people ask whether they are real.

Recall Lens gives a safer habit:

1. Start from official data.
2. Match only what might affect your home.
3. Open the agency notice instead of a random message link.

## Run

```bash
npm run refresh
```

Outputs land in `docs/`:

- `index.html` - small shareable page.
- `report.md` - same results in text.
- `recalls.json` - matched records.

Use a different profile:

```bash
node src/cli.js --profile data/household.example.json --out docs
```

## Profile

Edit `data/household.example.json`.

```json
{
  "watch": ["baby", "charger", "dresser"],
  "allergens": ["sesame", "fish", "milk"],
  "higherRisk": ["child", "pregnant", "older adult"]
}
```

## Sources

- FDA food enforcement API: https://api.fda.gov/food/enforcement.json
- CPSC recall retrieval API: https://www.saferproducts.gov/RestWebServices/Recall?format=json
- FDA recall guidance: https://www.fda.gov/food/buy-store-serve-safe-food/food-recalls-what-you-need-know
- CPSC consumer recall resources: https://www.cpsc.gov/About-CPSC/Consumer-Resources

This is not medical or legal advice. It is a cleaner way to find the official notice.
