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

`npm run typecheck` verifica o TypeScript.
