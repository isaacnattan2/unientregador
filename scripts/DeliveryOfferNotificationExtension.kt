package br.com.uniweb.unientregador

import android.os.Build
import androidx.annotation.Keep
import com.onesignal.notifications.INotificationReceivedEvent
import com.onesignal.notifications.INotificationServiceExtension

@Keep
class DeliveryOfferNotificationExtension : INotificationServiceExtension {
    override fun onNotificationReceived(event: INotificationReceivedEvent) {
        val notification = event.notification
        val data = notification.additionalData ?: return
        if (data.optString("section") != "available" || data.optString("offerId").isBlank()) return

        val deadline = data.optLong("offerExpiresAtMs", 0)
        if (deadline <= 0) return
        if (deadline <= System.currentTimeMillis()) {
            event.preventDefault()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notification.setExtender { builder ->
                builder.setWhen(deadline)
                    .setShowWhen(true)
                    .setUsesChronometer(true)
                    .setChronometerCountDown(true)
                    .setTimeoutAfter((deadline - System.currentTimeMillis()).coerceAtLeast(1))
            }
        }
    }
}
