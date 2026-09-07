type IconProps = { size?: number }

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const BackIcon = (props: IconProps) => <Svg {...props}><path d="M15 6l-6 6 6 6" /></Svg>
export const MoreIcon = (props: IconProps) => <Svg {...props}><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /></Svg>
export const PlusIcon = (props: IconProps) => <Svg {...props}><path d="M12 5v14M5 12h14" /></Svg>
export const DownIcon = (props: IconProps) => <Svg {...props}><path d="M12 5v14M6 13l6 6 6-6" /></Svg>
export const CloseIcon = (props: IconProps) => <Svg {...props}><path d="M6 6l12 12M18 6L6 18" /></Svg>
