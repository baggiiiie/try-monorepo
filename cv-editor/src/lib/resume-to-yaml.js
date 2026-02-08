export async function convertResumeToYaml(pdfText) {
  const res = await fetch('/api/convert-resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfText }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Conversion failed: ${err}`)
  }

  const { yaml } = await res.json()
  return yaml
}
