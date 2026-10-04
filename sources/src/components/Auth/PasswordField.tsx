/** A password input with a show/hide toggle; used wherever a password is typed or confirmed. */
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
  autoFocus?: boolean
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={shown ? `隱藏${label}` : `顯示${label}`}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOff size={20} strokeWidth={1.75} aria-hidden /> : <Eye size={20} strokeWidth={1.75} aria-hidden />}
        </button>
      </div>
    </div>
  )
}
