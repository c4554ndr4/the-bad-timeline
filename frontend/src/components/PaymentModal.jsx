import { useEffect, useRef } from 'react'

const creditsPerDollar = 200

const PaymentModal = ({ isOpen, onClose }) => {
  const buttonContainerRef = useRef(null)

  useEffect(() => {
    if (!isOpen || !buttonContainerRef.current) {
      return
    }

    buttonContainerRef.current.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js'
    script.async = true
    script.dataset.name = 'bmc-button'
    script.dataset.slug = 'cassiemccoy'
    script.dataset.color = '#FF5F5F'
    script.dataset.emoji = '🚀'
    script.dataset.font = 'Bree'
    script.dataset.text = 'Purchase Tokens'
    script.dataset.outlineColor = '#000000'
    script.dataset.fontColor = '#ffffff'
    script.dataset.coffeeColor = '#FFDD00'

    buttonContainerRef.current.appendChild(script)

    return () => {
      buttonContainerRef.current.innerHTML = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Purchase Credits</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="payment-content">
          <p>Support The Bad Timeline on Buy Me a Coffee. Every $1 adds {creditsPerDollar.toLocaleString()} credits to your account automatically once the webhook fires.</p>
          <ol>
            <li>Use the button below to send any amount (minimum $1 recommended).</li>
            <li><strong>Use the same email</strong> that you registered with so we can match your account.</li>
            <li>As soon as Buy Me a Coffee notifies us, your credits will appear here.</li>
          </ol>

          <div className="bmc-button-wrapper" ref={buttonContainerRef} />
          
          <div className="payment-info">
            <small>
              Powered by Buy Me a Coffee • Credits never expire • Webhook updates may take a few seconds
            </small>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaymentModal
