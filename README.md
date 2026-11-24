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

O projeto EAS `@uniapp1/unientregador` usa o canal `preview` para testes e `production` para distribuição. Os builds Android locais usam `preview` por padrão. O perfil `production` no EAS gera um APK no canal de produção.

Para publicar JavaScript e imagens compatíveis com o APK de teste, execute na raiz do app:

```powershell
npm run newversion:android
```

O comando publica no canal `preview` e depois envia um push pelo OneSignal para usuários Android com o canal e runtime registrados. Usa as variáveis locais `ONESIGNAL_DRIVER_APP_ID` e `ONESIGNAL_DRIVER_API_KEY`, com fallback para `../uniweb/backend/.env`. A chave fica no ambiente de publicação. Para publicar em produção após validar, use o EAS CLI com `--channel production --environment production --input-dir .expo/eas-production`. Mantenha `expo.version` igual à versão do APK enquanto a atualização mudar apenas JavaScript ou imagens. Mudanças em módulos nativos, permissões ou plugins exigem aumentar `expo.version` e `android.versionCode` e distribuir um novo APK. Use a mesma chave de assinatura do APK instalado para atualizá-lo por cima.

Na primeira publicação desse recurso, use `npm run newversion:android -- --skip-push`. Os testadores devem abrir o app, instalar essa OTA, manter as notificações permitidas e estar logados. Para testar a publicação seguinte, mantenha o app aberto e use `npm run newversion:android`. Ao receber o push, o app consulta o Expo e mostra o aviso em primeiro plano. O app também verifica ao abrir e pede confirmação antes de baixar e reiniciar. Atualizações adiadas podem ser instaladas em **Meu perfil → Atualizações do app**. Instale o APK 1.0.2 ou posterior para ativar esse fluxo.

Para mudar o número exibido no app após o login, ajuste `expo.extra.displayVersion` no `app.json` e publique com `npm run newversion:android`. O novo número aparece depois que o usuário instala a OTA. Para manter a compatibilidade com os APKs atuais, preserve os valores de `expo.version` e `android.versionCode` do APK.

`npm run typecheck` verifica o TypeScript.
