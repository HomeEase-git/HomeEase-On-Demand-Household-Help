import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const PRIMARY = '#2563eb'

function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function BookingsTrendChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="chart-placeholder">No booking activity yet</div>
  }

  const chartData = data.map((d) => ({ ...d, label: formatDateLabel(d.date) }))

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bookingsTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={PRIMARY} stopOpacity={0.25} />
              <stop offset="95%" stopColor={PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)' }}
          />
          <Area type="monotone" dataKey="count" name="Bookings" stroke={PRIMARY} strokeWidth={2} fill="url(#bookingsTrendFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
