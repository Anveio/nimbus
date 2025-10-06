import { type JSX } from 'react'
import styles from './App.module.css'

function App(): JSX.Element {
  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Mana Web Terminal</h1>
      <div className={styles.terminalWrapper}>
      {/* Terminal will go here */}
      </div>
      <p className={styles.helpText}>
        This demo echoes everything locally. Connect it to your transport by
        listening to `onData` and calling `terminal.write()`.
      </p>
    </main>
  )
}

export default App
