const fmt = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

export function formatCurrency(value: number) {
  return fmt.format(value)
}

export default function FormatCurrency({ value }: { value: number }) {
  return <span>{formatCurrency(value)}</span>
}
