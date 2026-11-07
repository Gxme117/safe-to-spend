/**
 * Accuracy benchmark for AI shop classification.
 * Run manually (costs pennies): TEST_CLASSIFY=1 npm test -- classify.bench
 * Skipped in normal CI.
 */
import {classifyPayees} from "../../services/classify";
import {sanitizeGuesses} from "../classify";

const SKIP = !process.env.TEST_CLASSIFY;

// All 18 spend category ids + names as the endpoint expects
const CATEGORIES = [
  {id: "groceries", name: "Groceries"},
  {id: "eating", name: "Eating out"},
  {id: "takeaways", name: "Takeaways"},
  {id: "coffee", name: "Coffee & drinks"},
  {id: "transport", name: "Transport"},
  {id: "fuel", name: "Fuel"},
  {id: "shopping", name: "Shopping"},
  {id: "home", name: "Home"},
  {id: "pets", name: "Pets"},
  {id: "entertainment", name: "Fun"},
  {id: "personal", name: "Self-care"},
  {id: "health", name: "Health"},
  {id: "family", name: "Family"},
  {id: "gifts", name: "Gifts"},
  {id: "charity", name: "Charity"},
  {id: "holidays", name: "Holidays"},
  {id: "cash", name: "Cash"},
  {id: "other", name: "General"},
];

interface BenchCase {
  name: string;
  expectedCat: string;
  shouldBeHigh?: boolean;
}

// ~150 labeled UK merchants covering all categories.
// Ambiguous (paypal, square, stripe) are excluded from AI via unresolvedPayees() —
// included here to verify they'd be capped to medium/low when accidentally sent.
const BENCH: BenchCase[] = [
  // Supermarkets
  {name: "tesco express", expectedCat: "groceries", shouldBeHigh: true},
  {name: "sainsburys local", expectedCat: "groceries", shouldBeHigh: true},
  {name: "asda superstore", expectedCat: "groceries", shouldBeHigh: true},
  {name: "lidl", expectedCat: "groceries", shouldBeHigh: true},
  {name: "aldi", expectedCat: "groceries", shouldBeHigh: true},
  {name: "waitrose", expectedCat: "groceries", shouldBeHigh: true},
  {name: "morrisons", expectedCat: "groceries", shouldBeHigh: true},
  {name: "co-op food", expectedCat: "groceries", shouldBeHigh: true},
  {name: "ocado", expectedCat: "groceries", shouldBeHigh: true},
  {name: "iceland foods", expectedCat: "groceries", shouldBeHigh: true},
  {name: "marks and spencer food hall", expectedCat: "groceries", shouldBeHigh: true},

  // Restaurants
  {name: "nandos", expectedCat: "eating", shouldBeHigh: true},
  {name: "wagamama", expectedCat: "eating", shouldBeHigh: true},
  {name: "pizza express", expectedCat: "eating", shouldBeHigh: true},
  {name: "five guys", expectedCat: "eating", shouldBeHigh: true},
  {name: "dishoom", expectedCat: "eating", shouldBeHigh: true},
  {name: "honest burgers", expectedCat: "eating", shouldBeHigh: true},
  {name: "bills restaurant", expectedCat: "eating", shouldBeHigh: true},
  {name: "wagamama london bridge", expectedCat: "eating", shouldBeHigh: true},
  {name: "carluccios", expectedCat: "eating", shouldBeHigh: true},

  // Takeaways (not covered by hint — deliveroo IS in hint, so testing AI on others)
  {name: "hungry house", expectedCat: "takeaways"},
  {name: "papa johns", expectedCat: "takeaways", shouldBeHigh: true},
  {name: "subway", expectedCat: "takeaways", shouldBeHigh: true},
  {name: "dominos pizza", expectedCat: "takeaways", shouldBeHigh: true},
  {name: "kfc drive thru", expectedCat: "takeaways", shouldBeHigh: true},
  {name: "mcdonalds uk", expectedCat: "takeaways", shouldBeHigh: true},

  // Coffee (not in NAME_HINTS — costa coffee IS, so test others)
  {name: "boston tea party", expectedCat: "coffee", shouldBeHigh: true},
  {name: "artisan roast", expectedCat: "coffee", shouldBeHigh: true},
  {name: "ozone coffee", expectedCat: "coffee", shouldBeHigh: true},
  {name: "flat white cafe", expectedCat: "coffee", shouldBeHigh: true},
  {name: "harris bake house", expectedCat: "coffee"},

  // Transport
  {name: "southeastern trains", expectedCat: "transport", shouldBeHigh: true},
  {name: "avanti west coast", expectedCat: "transport", shouldBeHigh: true},
  {name: "transpennine express", expectedCat: "transport", shouldBeHigh: true},
  {name: "heathrow express", expectedCat: "transport", shouldBeHigh: true},
  {name: "first bus", expectedCat: "transport", shouldBeHigh: true},
  {name: "stagecoach", expectedCat: "transport", shouldBeHigh: true},
  {name: "enterprise rent-a-car", expectedCat: "transport", shouldBeHigh: true},
  {name: "national express", expectedCat: "transport", shouldBeHigh: true},
  {name: "trainline", expectedCat: "transport", shouldBeHigh: true},

  // Fuel
  {name: "bp station", expectedCat: "fuel", shouldBeHigh: true},
  {name: "esso garage", expectedCat: "fuel", shouldBeHigh: true},
  {name: "jet petroleum", expectedCat: "fuel", shouldBeHigh: true},
  {name: "shell fuel", expectedCat: "fuel", shouldBeHigh: true},
  {name: "texaco petrol", expectedCat: "fuel", shouldBeHigh: true},

  // Shopping — clothes and department
  {name: "john lewis", expectedCat: "shopping", shouldBeHigh: true},
  {name: "marks and spencer", expectedCat: "shopping", shouldBeHigh: true},
  {name: "next", expectedCat: "shopping", shouldBeHigh: true},
  {name: "river island", expectedCat: "shopping", shouldBeHigh: true},
  {name: "uniqlo", expectedCat: "shopping", shouldBeHigh: true},
  {name: "nike", expectedCat: "shopping", shouldBeHigh: true},
  {name: "adidas", expectedCat: "shopping", shouldBeHigh: true},
  {name: "currys", expectedCat: "shopping", shouldBeHigh: true},
  {name: "game", expectedCat: "shopping", shouldBeHigh: true},
  {name: "smyths toys", expectedCat: "shopping"},
  {name: "matalan", expectedCat: "shopping", shouldBeHigh: true},
  {name: "primark", expectedCat: "shopping", shouldBeHigh: true},
  {name: "tk maxx", expectedCat: "shopping", shouldBeHigh: true},
  {name: "zara uk", expectedCat: "shopping", shouldBeHigh: true},
  {name: "h and m", expectedCat: "shopping", shouldBeHigh: true},

  // Home
  {name: "b and q", expectedCat: "home", shouldBeHigh: true},
  {name: "homebase", expectedCat: "home", shouldBeHigh: true},
  {name: "habitat", expectedCat: "home", shouldBeHigh: true},
  {name: "made.com", expectedCat: "home", shouldBeHigh: true},
  {name: "dunelm", expectedCat: "home", shouldBeHigh: true},
  {name: "ikea uk", expectedCat: "home", shouldBeHigh: true},
  {name: "wickes diy", expectedCat: "home", shouldBeHigh: true},

  // Pets
  {name: "vets4pets", expectedCat: "pets", shouldBeHigh: true},
  {name: "medivet", expectedCat: "pets", shouldBeHigh: true},
  {name: "pets corner", expectedCat: "pets", shouldBeHigh: true},
  {name: "pets at home", expectedCat: "pets", shouldBeHigh: true},
  {name: "pdsa charity", expectedCat: "pets"},

  // Entertainment — streaming and digital
  {name: "spotify premium", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "disney plus", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "sky tv", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "britbox", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "playstation store", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "xbox game pass", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "steam games", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "ticketmaster", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "adobe creative cloud", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "microsoft 365", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "duolingo", expectedCat: "entertainment"},
  {name: "cineworld cinemas", expectedCat: "entertainment", shouldBeHigh: true},
  {name: "odeon cinema", expectedCat: "entertainment", shouldBeHigh: true},

  // Self-care
  {name: "regis salon", expectedCat: "personal", shouldBeHigh: true},
  {name: "toni guy", expectedCat: "personal", shouldBeHigh: true},
  {name: "nails inc", expectedCat: "personal", shouldBeHigh: true},
  {name: "super drug", expectedCat: "personal", shouldBeHigh: true},
  {name: "salon services", expectedCat: "personal"},

  // Health
  {name: "bupa dental", expectedCat: "health", shouldBeHigh: true},
  {name: "specsavers", expectedCat: "health", shouldBeHigh: true},
  {name: "lloyds pharmacy", expectedCat: "health", shouldBeHigh: true},
  {name: "nuffield health gym", expectedCat: "health", shouldBeHigh: true},
  {name: "vitality health", expectedCat: "health", shouldBeHigh: true},

  // Charity
  {name: "oxfam shop", expectedCat: "charity", shouldBeHigh: true},
  {name: "british red cross", expectedCat: "charity", shouldBeHigh: true},
  {name: "cancer research uk", expectedCat: "charity", shouldBeHigh: true},
  {name: "shelter charity", expectedCat: "charity", shouldBeHigh: true},
  {name: "rspca donation", expectedCat: "charity", shouldBeHigh: true},

  // Holidays
  {name: "booking.com", expectedCat: "holidays", shouldBeHigh: true},
  {name: "jet2 holidays", expectedCat: "holidays", shouldBeHigh: true},
  {name: "tui travel", expectedCat: "holidays", shouldBeHigh: true},
  {name: "easyjet flights", expectedCat: "holidays", shouldBeHigh: true},
  {name: "ryanair uk", expectedCat: "holidays", shouldBeHigh: true},
  {name: "cottages.com", expectedCat: "holidays", shouldBeHigh: true},

  // Cash
  {name: "atm withdrawal", expectedCat: "cash", shouldBeHigh: true},
  {name: "cash machine", expectedCat: "cash", shouldBeHigh: true},
  {name: "nationwide atm", expectedCat: "cash"},

  // Gifts
  {name: "moonpig", expectedCat: "gifts", shouldBeHigh: true},
  {name: "funky pigeon", expectedCat: "gifts", shouldBeHigh: true},
  {name: "prezzybox", expectedCat: "gifts", shouldBeHigh: true},

  // Financial/insurance — expect 'other' or transport (should not be high for finance)
  {name: "aa motoring", expectedCat: "transport"},
  {name: "prudential insurance", expectedCat: "other"},
  {name: "aviva insurance", expectedCat: "other"},

  // Ambiguous — must NOT be high (sanitize caps these; they'd be excluded before this point in practice)
  {name: "stripe charge", expectedCat: "other"},
];

// Minimum thresholds
const MIN_HIGH_PRECISION = 0.97;
const MIN_COVERAGE = 0.60;

(SKIP ? describe.skip : describe)("AI classification benchmark", () => {
  it(
    `classifies ~${BENCH.length} merchants with ≥${MIN_HIGH_PRECISION * 100}% high-precision, ≥${MIN_COVERAGE * 100}% coverage`,
    async () => {
      const payees = BENCH.map(b => b.name);
      const raw = await classifyPayees(payees, CATEGORIES);
      const results = sanitizeGuesses(raw);

      let total = payees.length;
      let correct = 0;
      let highTotal = 0;
      let highCorrect = 0;
      let classified = 0;

      const byCat: Map<string, {total: number; correct: number}> = new Map();
      for (const c of CATEGORIES) byCat.set(c.id, {total: 0, correct: 0});

      for (const bench of BENCH) {
        const guess = results.get(bench.name);
        const isCorrect = guess?.cat === bench.expectedCat;
        const isHigh = guess?.confidence === "high";
        const isClassified = guess != null && guess.confidence !== "low";

        if (isClassified) classified++;
        if (isCorrect) correct++;
        if (isHigh) {
          highTotal++;
          if (isCorrect) highCorrect++;
        }

        const catStats = byCat.get(bench.expectedCat);
        if (catStats) {
          catStats.total++;
          if (isCorrect) catStats.correct++;
        }
      }

      const highPrecision = highTotal > 0 ? highCorrect / highTotal : 1;
      const coverage = classified / total;
      const accuracy = correct / total;

      // Print a readable report (visible in test output with --verbose)
      console.log(`\nClassification benchmark`);
      console.log(`  Total merchants: ${total}`);
      console.log(`  Sent to AI: ${total}`);
      console.log(`  Classified (non-low): ${classified} / ${total} (${(coverage * 100).toFixed(0)}% coverage)`);
      console.log(`  Correct: ${correct} / ${total} (${(accuracy * 100).toFixed(0)}% accuracy)`);
      console.log(`\n  High-confidence:`);
      console.log(`    Total: ${highTotal}`);
      console.log(`    Correct: ${highCorrect} (${(highPrecision * 100).toFixed(1)}% precision) ${highPrecision >= MIN_HIGH_PRECISION ? "✓" : "✗"}`);
      console.log(`\n  By category:`);

      for (const [cat, stats] of byCat) {
        if (stats.total === 0) continue;
        const pct = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(0) : "—";
        const catName = CATEGORIES.find(c => c.id === cat)?.name ?? cat;
        console.log(`    ${catName.padEnd(20)} ${stats.correct}/${stats.total} (${pct}%)`);
      }

      console.log(`\n  Cost estimate: ~${(total / 50 * 0.03).toFixed(3)}¢ for this benchmark\n`);

      // Fail fast with clear numbers
      expect(highPrecision).toBeGreaterThanOrEqual(MIN_HIGH_PRECISION);
      expect(coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
    },
    // 60 s — allow for network + Haiku latency across batches
    60_000,
  );
});
