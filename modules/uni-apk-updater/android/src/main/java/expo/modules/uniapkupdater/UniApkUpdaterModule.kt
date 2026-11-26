package expo.modules.uniapkupdater

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

class ApkUpdateFileProvider : FileProvider()

class UniApkUpdaterModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("UniApkUpdater")

        AsyncFunction("openInstaller") Coroutine { fileUri: String, expectedVersion: Int, expectedHash: String ->
            val activity = appContext.currentActivity
                ?: throw IllegalStateException("Abra o UniEntregador para instalar a atualização.")
            val manager = activity.packageManager
            val packageName = activity.packageName
            val uri = Uri.parse(fileUri)
            require(uri.scheme == "file") { "Arquivo de atualização inválido." }
            val path = requireNotNull(uri.path) { "Arquivo de atualização inválido." }
            val apk = File(path).canonicalFile
            val cache = File(activity.cacheDir, "apk-updates").canonicalFile
            require(apk.parentFile == cache && apk.isFile && apk.extension == "apk") { "Arquivo de atualização inválido." }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !manager.canRequestPackageInstalls()) {
                withContext(Dispatchers.Main) {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                }
                return@Coroutine "permission"
            }

            withContext(Dispatchers.IO) {
                validateApk(manager, packageName, apk, expectedVersion, expectedHash)
            }

            val contentUri = FileProvider.getUriForFile(activity, "$packageName.uni-apk-updates", apk)
            withContext(Dispatchers.Main) {
                activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(contentUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                })
            }
            "installer"
        }
    }

    private fun validateApk(manager: PackageManager, packageName: String, apk: File, expectedVersion: Int, expectedHash: String) {
        val digest = MessageDigest.getInstance("SHA-256")
        apk.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                digest.update(buffer, 0, count)
            }
        }
        require(digest.digest().toHex() == expectedHash) { "O arquivo baixado está incompleto ou foi alterado." }

        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
            else PackageManager.GET_SIGNATURES
        @Suppress("DEPRECATION")
        val installed = manager.getPackageInfo(packageName, flags)
        @Suppress("DEPRECATION")
        val update = manager.getPackageArchiveInfo(apk.path, flags)
            ?: throw IllegalArgumentException("Não foi possível ler o APK baixado.")
        require(update.packageName == packageName && update.code() == expectedVersion.toLong() &&
            update.code() > installed.code()) { "O APK não corresponde a uma versão mais recente do UniEntregador." }
        val installedSigners = installed.certificates()
        require(installedSigners.isNotEmpty() && installedSigners == update.certificates()) {
            "A assinatura do APK é diferente da assinatura instalada."
        }
    }

    @Suppress("DEPRECATION")
    private fun PackageInfo.code() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) longVersionCode else versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun PackageInfo.certificates(): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) signingInfo?.apkContentsSigners else this.signatures
        return signatures.orEmpty().map { it.toByteArray().toHex() }.toSet()
    }

    private fun ByteArray.toHex() = joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
}
