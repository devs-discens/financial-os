// Generate amortization schedule / mortgage statements for Heritage Financial
// Canadian mortgage: semi-annual compounding, monthly payments

function generateAmortizationSchedule(mortgage) {
  const {
    originalPrincipal,
    interestRate,
    originalStartDate,
    monthlyPayment,
  } = mortgage;

  // Canadian semi-annual compounding: effective monthly rate
  const nominalSemiAnnual = interestRate / 100;
  const effectiveMonthly = Math.pow(1 + nominalSemiAnnual / 2, 1 / 6) - 1;

  const statements = [];
  let balance = originalPrincipal;
  const startDate = new Date(originalStartDate);

  // Generate statements from origination to present
  const now = new Date();
  let statementNumber = 0;

  while (balance > 0 && statementNumber < 300) { // max 25 years
    statementNumber++;
    const statementDate = new Date(startDate);
    statementDate.setMonth(statementDate.getMonth() + statementNumber);

    if (statementDate > now) break;

    const interestPayment = Math.round(balance * effectiveMonthly * 100) / 100;
    const principalPayment = Math.round((monthlyPayment - interestPayment) * 100) / 100;
    balance = Math.round((balance - principalPayment) * 100) / 100;

    const month = statementDate.toLocaleString('en-CA', { month: 'long', year: 'numeric' });
    const periodStart = new Date(statementDate);
    periodStart.setMonth(periodStart.getMonth() - 1);

    statements.push({
      statementId: `htg-mtg-stmt-${String(statementNumber).padStart(3, '0')}`,
      accountId: 'htg-mtg-001',
      description: `Mortgage Statement - ${month}`,
      statementDate: statementDate.toISOString().split('T')[0],
      startDate: periodStart.toISOString().split('T')[0],
      endDate: statementDate.toISOString().split('T')[0],
      monthlyPayment,
      principalPayment,
      interestPayment,
      remainingBalance: Math.max(0, balance),
      paymentNumber: statementNumber,
    });
  }

  return statements;
}

module.exports = { generateAmortizationSchedule };
