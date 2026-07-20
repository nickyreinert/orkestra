# Coding Instructions

## HTML
- Semantic tags (header, main, footer, article, section)
- Accessibility (ARIA labels, alt text)

## CSS
- Mobile-first approach
- CSS Variables for colors/fonts
- BEM naming convention

## JavaScript
- ES6+ syntax (const/let, arrow functions)
- Modular code (import/export)
- Event delegation
- No global variables

## External CLI Review (Self-Correction)
- **Check Availability**: Look at `.orkestra/config.yaml` to see if `sub_agents` are configured.
- **Execute Review**: If available, run it against your generated code.
    - Example: `.orkestra/scripts/run_sub_agent.sh gemini "Review this code" ...`
- **Incorporate Feedback**: Read the output and fix issues.
