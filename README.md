# LID 2026

Aplicación del torneo interno de vóley de la E.E.S.T. N.º 2. Incluye el registro público de equipos, la consulta de equipos y normas, y un panel administrativo privado. Está construida con Next.js 15, TypeScript, Neon PostgreSQL y Better Auth.

## Requisitos

- Node.js 20.9 o posterior.
- Una base PostgreSQL de Neon para ejecutar las funciones que dependen de datos.

## Desarrollo local

```powershell
npm ci
Copy-Item .env.example .env.local
```

Completa `.env.local` con valores locales. Nunca subas ese archivo ni copies secretos en variables `NEXT_PUBLIC_*`.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | URL de conexión de Neon con SSL habilitado. |
| `BETTER_AUTH_SECRET` | Secreto aleatorio de Better Auth, de al menos 32 caracteres. |
| `BETTER_AUTH_URL` | Origen de la aplicación; localmente `http://localhost:3000`. |
| `ADMIN_EMAIL` | Único correo autorizado para el panel. |

Prepara el esquema y verifica la conexión:

```powershell
npm run db:migrate
npm run db:check
```

Inicia la aplicación con `npm run dev`. El acceso administrativo se realiza manualmente en `/atun/`; la interfaz pública no incluye un enlace al panel. El servidor comprueba la sesión y el correo autorizado.

El admin existente se conserva en Better Auth. No ejecutes `npm run admin:create` si esa cuenta ya existe. Para una instalación nueva, el comando solicita la contraseña de forma interactiva; para cambiarla, usa `npm run admin:reset-password`. No pases contraseñas como argumentos de consola.

## Normas

El panel permite importar y exportar el documento JSON LID v1. El contrato y el prompt de reestructuración están en `.agents/skills/vit-normas/references/`. Importar carga el borrador; **Guardar documento** persiste los cambios y la opción de publicación define su visibilidad.

## Publicación en Vercel

1. Importa `CapriaFranco/lid` desde Vercel y deja el directorio raíz del proyecto.
2. Configura las cuatro variables de la tabla anterior en el entorno **Production**. Usa la URL pública exacta de la aplicación en `BETTER_AUTH_URL`.
3. Antes de poner la aplicación en producción, confirma que `DATABASE_URL` usa credenciales vigentes y una conexión SSL de Neon. Las credenciales que hayan sido compartidas fuera del gestor de secretos deben rotarse.
4. Ejecuta `npm run db:migrate` una vez contra la base de producción y confirma con `npm run db:check`. No configures migraciones como parte de cada inicio de la aplicación.
5. Vercel construye y publica la aplicación al integrar los cambios en `main`; los pull requests pueden generar despliegues de vista previa.

El build usa el flujo estándar de Next.js (`next build`). Las migraciones no se ejecutan automáticamente durante el build o al iniciar el servidor.

## GitHub Actions

Los pull requests y los cambios en `main` ejecutan `npm ci`, ESLint y la comprobación de TypeScript. La compilación de producción se realiza en Vercel con las variables del entorno configuradas allí.
