export default function ExplainabilityWidget({
  insights = [],
  title = 'Why This Load Works Operationally',
  kicker = 'Explicability',
  className = 'explainability-widget',
}) {
  if (!Array.isArray(insights) || insights.length === 0) return null

  return (
    <section className={className} aria-label="Operational explainability">
      <header className="explainability-header">
        <p className="explainability-kicker">{kicker}</p>
        <h3>{title}</h3>
      </header>
      <ul className="explainability-list">
        {insights.map((insight, index) => (
          <li key={`insight-${index}`}>{insight}</li>
        ))}
      </ul>
    </section>
  )
}
