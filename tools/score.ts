// tools/score.ts
import * as fs from "fs";

type Norms = Record<string, number>;
type Weights = Record<string, number>;
type AgentScoreCard = {
  fixAttempts?: number;
  issuesFound?: number;
  issuesFixed?: number;
  compilable?: number;
  testsPassRate?: number;
  [key: string]: any;
};

function safeRead(p: string) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn("failed to read", p, e);
    return null;
  }
}

function applyAgentScoreCard(norms: Norms) {
  const scoreCard = safeRead("tools/AgentScoreCard.json") as AgentScoreCard | null;
  if (!scoreCard) return;

  const fieldMap: Record<string, keyof AgentScoreCard> = {
    unitTestPassRate: "testsPassRate",
    compilation: "compilable",
    issuesFound: "issuesFound",
    issuesFixed: "issuesFixed",
    fixAttempts: "fixAttempts"
  };

  for (const [normKey, cardKey] of Object.entries(fieldMap)) {
    const raw = scoreCard[cardKey];
    const val = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isNaN(val)) {
      norms[normKey] = val;
    }
  }
}

/* Normalizers */

// Sonar metrics: sonar_metrics.json contains measures array
function readSonarMetrics(sonarJson: any) {
  const out: Record<string, number | string> = {};
  try {
    const measures = sonarJson?.component?.measures ?? [];
    for (const m of measures) {
      out[m.metric] = m.value;
    }
  } catch (e) {
    console.warn("sonar parsing failed", e);
  }
  return out;
}

function normFromSonarMeasure(measures: Record<string, any>) {
  const norms: Partial<Record<string, number>> = {};

  console.log("[Sonar] code_smells:", measures.code_smells);
  console.log("[Sonar] sqale_index:", measures.sqale_index);
  console.log("[Sonar] complexity:", measures.complexity);
  console.log("[Sonar] duplicated_lines_density:", measures.duplicated_lines_density);
  console.log("[Sonar] reliability_rating:", measures.reliability_rating);
  console.log("[Sonar] security_rating:", measures.security_rating);

  const smells = Number(measures.code_smells ?? 0);
  norms.maintainability = Math.max(0, 100 - smells - (measures.sqale_index * 0.2));
  // code_smells: #
  // sqale_index: mins

  norms.performance =  Number(measures.complexity ?? 0);
  // complexity: branches

  const dup = Number(measures.duplicated_lines_density ?? 0);
  norms.duplication = Math.max(0, dup * 100);
  // duplicated_lines_density: %
  
  const reliabilityRating = Number(measures.reliability_rating ?? 0);
  norms.reliability = Math.max(
    0,
    Math.min(100, ((5 - reliabilityRating) / 4) * 100)
  );
  // reliability_rating: 1 (best) - 5 (worst), mapped so 1 -> 100, 5 -> 0

  const securityRating = Number(measures.security_rating ?? 0);
  norms.security = Math.max(
    0,
    Math.min(100, ((5 - securityRating) / 4) * 100)
  );
  // security_rating: 1 (best) - 5 (worst), mapped so 1 -> 100, 5 -> 0

  return norms as Record<string, number>;
}

/* Composite computation */
function computeComposite(norms: Norms, weights: Weights): number {
  let s = 0;
  for (const k of Object.keys(weights)) {
    const w = weights[k] ?? 0;
    const m = norms[k] ?? 0;
    s += m * (w / 100);
  }
  return Math.round(s * 100) / 100;
}

/**
 * Compute KLOC (thousands of lines of code) for the primary app entrypoint.
 * Currently this is based on `src/app.ts` only, since that file contains
 * almost all of the example project logic and UI.
 */
function computeAppKloc(): number {
  try {
    const srcPath = "src/app.ts";
    if (!fs.existsSync(srcPath)) return -1;

    const contents = fs.readFileSync(srcPath, "utf8");
    // Count logical lines; treat every line in the file as a code line for
    // simplicity. This keeps the metric easy to reason about.
    const totalLines = contents.split(/\r\n|\n|\r/).length;

    // thousands of lines of code
    const kloc = totalLines / 1000;
    return Math.round(kloc * 100) / 100; // 2 decimal places
  } catch (e) {
    console.warn("failed to compute KLOC from src/app.ts", e);
    return -1;
  }
}

function main(): Norms {
  const filesInfo = safeRead("files_info.json") || { total_lines: 0 };
  const sonarMetricsRaw = safeRead("sonar_metrics.json");

  const totalLines = filesInfo?.total_lines ?? 0;

  // norms from individual tools
  // (initialize defaults; individual normalizers can override)
  const norms: Norms = {
    // Correctness
    unitTestPassRate: -1,
    compilation: -1,
    issuesFound: -1,
    issuesFixed: -1,
	  autoFixRate:0,
    // Quality
    security: -1,
    reliability: -1,
    maintainability: -1,
    duplication: -1,
    performance: -1,
    // Efficiency
    fixAttempts: -1,
    kloc: -1
  };
  
  // Dynamically compute KLOC from src/app.ts so the scorecard reflects the
  // current size of the main application file.
  const appKloc = computeAppKloc();
  if (appKloc >= 0) {
    norms.kloc = appKloc;
    console.log("[KLOC] src/app.ts:", appKloc, "KLOC");
  }

  applyAgentScoreCard(norms);

  // incorporate Sonar measures
  if (sonarMetricsRaw) {
    const sonarMap = readSonarMetrics(sonarMetricsRaw);
    const sonarNorms = normFromSonarMeasure(sonarMap);
    for (const k of Object.keys(sonarNorms)) {
      const val = sonarNorms[k];
      if (typeof val === "number") {
        // Prefer Sonar-derived norm; overwrite any existing value.
        norms[k] = val;
      }
    }
  }

  // Primary output is just norms; logs are kept for visibility.
  fs.writeFileSync("norms.json", JSON.stringify(norms, null, 2), "utf8");

  // Write a compact, comma-separated summary line to result.json
  // Order: compilation, issuesFound, issuesFixed, autoFixRate, security,
  //        reliability, maintainability, duplication, performance, fixAttempts
  const resultValues = [
    norms.unitTestPassRate,
    norms.compilation,
    norms.issuesFound,
    norms.issuesFixed,
    norms.autoFixRate,
    norms.security,
    norms.reliability,
    norms.maintainability,
    norms.duplication,
    norms.performance,
    norms.fixAttempts
  ];

  const csvLine = resultValues.join(",");
  fs.writeFileSync("result.json", csvLine, "utf8");

  console.log("Norms summary written to result.json (CSV):", csvLine);

  return norms;
}

const norms = main();
export default norms;
