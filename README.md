# UniEntregador

App React Native com Expo para Android e iOS. Use a mesma conta de entregador cadastrada no Uniweb.

## Rodar

```powershell
npm install
npm start
```

A URL padrão é `https://uniweb-p7mz.onrender.com/api`. Para testar outro backend, copie `.env.example` para `.env` e ajuste `EXPO_PUBLIC_API_URL`. Num aparelho físico use um endereço que ele possa alcançar. Em um emulador Android, o backend local do computador pode ser acessado em `http://10.0.2.2:3000/api`.

Na pasta `uniweb/backend`, rode `npm run dev` com a porta 3000 livre. Se o backend usar outra porta, ajuste também a URL no `.env` do app.

Reinicie o Expo após alterar o arquivo `.env`.

O login usa `POST /auth/login`, e a tela inicial usa `GET /orders/available-deliveries` com o token da conta. Publique a rota de entregas no backend antes de testar contra o Render.

## Mapa de entregas

O MapLibre exibe dados do OpenStreetMap com o estilo Liberty do OpenFreeMap. Para usar outro estilo compatível, configure `EXPO_PUBLIC_OSM_MAP_STYLE_URL` no `.env`. O backend do Uniweb precisa ter as URLs do Nominatim e do Valhalla configuradas para calcular as rotas de moto.

Se a pasta nativa já existe, aplique os plugins com `npx expo prebuild --platform android` (ou a plataforma correspondente) e compile novamente com `npm run android`. O mapa aparece após o aceite ou pelo botão **Ver mapa da entrega**. O app atualiza a posição enquanto estiver aberto e com permissão de localização.

## Builds

- Android local com Android Studio configurado: `npm run android`.
- iOS local em macOS com Xcode: `npm run ios`.
- Android e iOS pela nuvem, inclusive a partir do Windows: configure o projeto na sua conta Expo com `npx eas-cli@latest build:configure` e execute `npx eas-cli@latest build --platform all --profile production`.
- Para teste, use o perfil `preview` no Android para gerar APK, ou `ios-simulator` para gerar um build para o simulador de iOS.

O build de distribuição de iOS exige credenciais de assinatura da Apple. O identificador inicial em ambas as plataformas é `br.com.uniweb.unientregador`.

## Atualizações do UniEntregador

Para compilar e publicar um APK completo na área do entregador do UniWeb, execute `npm run publishapp` na raiz do UniEntregador. Antes da primeira publicação:

1. Aplique `uniweb/backend/migrations/add_driver_app_release.sql` e publique a API do UniWeb atualizada. Enquanto não houver APK no banco, o botão usa `DRIVER_APP_DOWNLOAD_URL`.
2. Em `uniweb/backend/.env`, use as credenciais do banco e do Neon Object Storage de distribuição. O script usa `NEON_STORAGE_BUCKET` ou, se configurado, `DRIVER_APP_APK_BUCKET`. O bucket precisa ter acesso `public_read`.
3. Atualize `expo.version` e aumente `android.versionCode` em `app.json` para cada novo APK.

Na primeira execução de um catálogo vazio, o comando cria a chave de distribuição automaticamente se você não configurar uma chave própria. As próximas publicações reutilizam o keystore e as credenciais em `uniweb/backend/.env.driver-app-signing/` e conferem a assinatura com a registrada no banco. Faça backup privado dessa pasta. A primeira instalação com a chave nova pode exigir desinstalar uma versão assinada com outra chave.

Para continuar usando uma chave existente, configure estas variáveis em `uniweb/backend/.env`. O Gradle assina o APK automaticamente:

```dotenv
UNI_ANDROID_KEYSTORE=C:/chaves/unientregador.jks
UNI_ANDROID_KEYSTORE_PASSWORD=...
UNI_ANDROID_KEY_ALIAS=...
UNI_ANDROID_KEY_PASSWORD=...
```

Se precisar validar a compatibilidade com um APK distribuído antes deste catálogo, configure também `DRIVER_APP_CURRENT_APK` com o caminho absoluto desse APK. O comando lê o certificado e o código da versão diretamente do arquivo. Você também pode informar `DRIVER_APP_APK_SIGNER_SHA256` caso já tenha o SHA-256 do certificado.

O comando gera o APK no canal `preview` por padrão. Para gerar um APK de produção, use `npm run publishapp -- --channel production`. O APK usa a API pública do UniWeb (substituível por `DRIVER_APP_RELEASE_API_URL`). Ele atualiza o link no banco após validar a assinatura e confirmar que o arquivo está acessível sem credenciais. Depois de trocar o link, o comando remove APKs anteriores no prefixo `driver-app/` do bucket configurado. Se a limpeza falhar, execute `npm run publishapp` com o mesmo `versionCode` para concluir a limpeza sem recompilar. O botão **Baixar aplicativo** mostra a nova versão na próxima carga do painel. Use o fluxo abaixo para atualizações OTA.

Em APKs com o atualizador nativo, o aviso de versão e o sininho abrem o download dentro do UniEntregador. O app verifica o arquivo e a assinatura antes de abrir o instalador do Android. O sistema pode pedir autorização para instalar a partir do UniEntregador na primeira vez. O APK fica disponível no cache se o entregador decidir instalar depois. A primeira instalação com esse recurso é feita com o APK da área do entregador no UniWeb.

O `publishapp` registra o aviso no histórico e envia um push Android pelo OneSignal depois de atualizar o link do UniWeb. Use as credenciais `ONESIGNAL_DRIVER_APP_ID` e `ONESIGNAL_DRIVER_API_KEY` do app. O envio usa o segmento `Total Subscriptions`, configurável por `ONESIGNAL_DRIVER_APK_SEGMENT`. Se o envio falhar, rode o comando com o mesmo `versionCode` para repetir só as etapas pendentes. A API precisa da migração `add_driver_notifications.sql`.

Para enviar os source maps ao Sentry no `publishapp`, configure `SENTRY_AUTH_TOKEN` em `.env.local` na raiz do UniEntregador. O build também aceita a variável do terminal ou um token no `.env` do app. O `app.json` contém o DSN público usado em execução. Guarde o token de upload fora do Git.

O projeto EAS `@uniapp1/unientregador` usa o canal `preview` para testes e `production` para distribuição. Os builds Android locais usam `preview` por padrão. O perfil `production` no EAS gera um APK no canal de produção.

Para publicar JavaScript e imagens para o APK distribuído pelo `publishapp`, execute na raiz do app:

```powershell
npm run newversion:android
```

O comando publica no canal `preview` por padrão e envia o aviso pelo OneSignal aos aparelhos Android inscritos com o mesmo canal e runtime. Use `npm run newversion:android -- --channel production` para publicar em produção. Acrescente `--skip-push` para publicar sem aviso. Mantenha `expo.version` e `android.versionCode` da versão instalada ao publicar JavaScript ou imagens. Mudanças em módulos nativos, permissões ou plugins exigem um novo APK.

O canal é gravado no APK. Para passar um aparelho de `production` para `preview`, instale um novo APK gerado para `preview`.

O app também verifica a OTA ao abrir e pede confirmação antes de baixar e reiniciar. Para verificar manualmente, use **Meu perfil → Atualizações do app**. O build envia os source maps da OTA usando o token do Sentry do ambiente, de `.env.local` ou de `.env`.

Para mudar o número exibido no app após o login, ajuste `expo.extra.displayVersion` no `app.json` e publique com `npm run newversion:android`. O novo número aparece depois que o usuário instala a OTA. Para manter a compatibilidade com os APKs atuais, preserve os valores de `expo.version` e `android.versionCode` do APK.

`npm run typecheck` verifica o TypeScript.
