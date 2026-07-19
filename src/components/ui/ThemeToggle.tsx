'use client'

import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import Icon from '@/components/ui/icon'

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    if (theme === 'dark') {
      setTheme('light')
    } else if (theme === 'light') {
      setTheme('dark')
    } else {
      setTheme('dark')
    }
  }

  return (
    <motion.button
      onClick={toggleTheme}
      className="p-2 hover:bg-accent rounded-lg transition-colors"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      whileTap={{ scale: 0.95 }}
    >
      {theme === 'dark' ? (
        <Icon type="sun" size="sm" />
      ) : (
        <Icon type="moon" size="sm" />
      )}
    </motion.button>
  )
}

export default ThemeToggle