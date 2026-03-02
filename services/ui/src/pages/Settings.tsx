import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { updateProfile } from '../api/auth'
import type { UserProfile } from '../types/auth'

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']

const RELATIONSHIP_OPTIONS = ['Single', 'Common-law', 'Married', 'Separated', 'Divorced', 'Widowed', 'Single parent']

const HOUSING_OPTIONS = ['Renting', 'Homeowner', 'Living with family', 'Other']

export default function Settings() {
  const { user, refreshUser } = useAuth()
  const profile = user?.profile ?? {} as Partial<UserProfile>

  const [form, setForm] = useState({
    age: profile.age ?? '',
    occupation: profile.occupation ?? '',
    employer: profile.employer ?? '',
    income: profile.income ?? '',
    city: profile.city ?? '',
    province: profile.province ?? '',
    relationship_status: profile.relationship_status ?? '',
    housing_status: profile.housing_status ?? '',
    dependents: profile.dependents ?? 0,
    financial_goals: (profile.financial_goals ?? []).join(', '),
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const payload: Record<string, unknown> = {
        age: Number(form.age) || 0,
        occupation: form.occupation,
        employer: form.employer,
        income: Number(form.income) || 0,
        city: form.city,
        province: form.province,
        relationship_status: form.relationship_status,
        housing_status: form.housing_status,
        dependents: Number(form.dependents) || 0,
        financial_goals: form.financial_goals
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
      }
      await updateProfile(payload)
      await refreshUser()
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">Settings</h1>

      <div className="rounded-xl bg-white border border-ws-border p-6 shadow-sm space-y-5">
        <h2 className="text-lg font-bold">Profile</h2>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Age" value={form.age} type="number" onChange={(v) => handleChange('age', v)} />
          <Field label="Occupation" value={form.occupation} onChange={(v) => handleChange('occupation', v)} />
          <Field label="Employer" value={form.employer} onChange={(v) => handleChange('employer', v)} />
          <Field label="Annual Income" value={form.income} type="number" onChange={(v) => handleChange('income', v)} />
          <Field label="City" value={form.city} onChange={(v) => handleChange('city', v)} />
          <SelectField label="Province" value={form.province} options={PROVINCES} onChange={(v) => handleChange('province', v)} />
          <SelectField label="Relationship Status" value={form.relationship_status} options={RELATIONSHIP_OPTIONS} onChange={(v) => handleChange('relationship_status', v)} />
          <SelectField label="Housing Status" value={form.housing_status} options={HOUSING_OPTIONS} onChange={(v) => handleChange('housing_status', v)} />
          <Field label="Dependents" value={form.dependents} type="number" onChange={(v) => handleChange('dependents', v)} />
          <Field label="Financial Goals" value={form.financial_goals} onChange={(v) => handleChange('financial_goals', v)} placeholder="Comma-separated, e.g. First home, Emergency fund" />
        </div>

        {error && <p className="text-sm text-ws-red">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-ws-accent px-5 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-ws-green font-medium">Profile saved</span>}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  type = 'text',
  placeholder,
  onChange,
}: {
  label: string
  value: string | number
  type?: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs text-ws-muted font-semibold uppercase tracking-wider mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2 text-sm text-ws-text placeholder-ws-muted focus:outline-none focus:border-ws-accent"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs text-ws-muted font-semibold uppercase tracking-wider mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2 text-sm text-ws-text focus:outline-none focus:border-ws-accent"
      >
        <option value="">Select...</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}
