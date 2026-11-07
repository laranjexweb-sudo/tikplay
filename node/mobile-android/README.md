# TikPlay Sons para Android

App Android nativo que abre a tela web existente `/sons-mobile/` e mantém uma conexão autenticada com o TikPlay em um serviço Android de reprodução em primeiro plano. O serviço toca alertas e narrações com ExoPlayer mesmo quando a Activity sai da frente.

## Desenvolvimento

- Android Studio instalado com SDK Platform 37, Build Tools e Platform Tools.
- Java 17 para compilar o app; o Gradle usa o JDK incluído no Android Studio.
- Node não é necessário para compilar este app nativo.
- Abra esta pasta no Android Studio ou execute `gradlew.bat assembleDebug`.
- APK de desenvolvimento: `app/build/outputs/apk/debug/app-debug.apk`.

O app abre `https://tikplay.com.br/sons-mobile/`; o login é feito nessa tela. Para depurar outro servidor, altere `MainActivity.TIKPLAY_URL` localmente. A integração JavaScript nativa só é oferecida em páginas do domínio TikPlay.

## Assinatura de distribuição

O APK de desenvolvimento usa a chave debug do Android Studio. Antes de distribuir uma versão de produção, gere e guarde com backup uma chave própria de assinatura; todas as atualizações precisam usar a mesma chave. Não comite keystores nem senhas.
