# CratisApp

A web application built with Cratis Arc and Chronicle.

## Prerequisites

- .NET 9.0 or later
- Docker and Docker Compose (for running Chronicle and Aspire Dashboard)
- Node.js 20 or later
- A package manager (yarn, pnpm, or npm)

## Getting Started

1. Start the infrastructure:

```bash
docker-compose up -d
```

This will start:

- Chronicle (with MongoDB on port 27017)
- Aspire Dashboard (on port 18888)

2. Install frontend dependencies:

```bash
npm install
```

3. Start the frontend development server:

```bash
npm run dev
```

4. Run the application:

```bash
dotnet run
```

The application will be available at:

- Backend API: http://localhost:5000
- Swagger UI: http://localhost:5000/swagger
- Frontend: http://localhost:5173 (Vite dev server)
- Aspire Dashboard: http://localhost:18888

## Project Structure

```shell
CratisApp.csproj          - .NET project file
Program.cs                - Application entry point
GlobalUsings.cs           - Global using directives
appsettings.json          - Configuration
package.json              - Node.js dependencies
tsconfig.json             - TypeScript configuration
docker-compose.yml        - Infrastructure services
.frontend/                - Frontend application shell
  index.html              - HTML entry point
  main.tsx                - React entry point
  App.tsx                 - Root React component
  index.css               - Global styles
  vite.config.ts          - Vite configuration
<Module>/                 - A domain module
  <Feature>/              - A vertical slice
    <Feature>.tsx         - React composition page
    <Feature>.cs          - Backend C# code
    index.ts              - TypeScript barrel export
    <Slice>/              - Sub-slice
      ...
```

## Vertical Slices

This template follows a **vertical slice architecture** where backend and frontend code live side by side in the same folder. Each feature folder holds all the artifacts needed for that slice — C# commands, queries, events, and React components — rather than separating them by layer (e.g. `Controllers/`, `Services/`, `Components/`).

This makes it easy to reason about a feature, evolve it independently, and keep related code together.

- Each slice is a self-contained unit of functionality from UI to backend.
- C# and TypeScript files coexist in the same directory.
- Run `dotnet build` after backend changes to regenerate the TypeScript proxies used by the frontend.

## Cratis Build Tool (Proxy Generation)

This template is designed to work with `Cratis.Arc.ProxyGenerator.Build`, which generates TypeScript command/query proxies during `dotnet build`.

### Add package reference

If not already present, add the build package to your `.csproj`:

```xml
<ItemGroup>
  <PackageReference Include="Cratis.Arc.ProxyGenerator.Build" Version="<version>" />
</ItemGroup>
```

### Required setting

`CratisProxiesOutputPath` tells the build tool where generated TypeScript proxies should be written.

```xml
<PropertyGroup>
  <CratisProxiesOutputPath>$(MSBuildThisFileDirectory)Features</CratisProxiesOutputPath>
</PropertyGroup>
```

### Common configuration

```xml
<PropertyGroup>
  <CratisProxiesOutputPath>$(MSBuildThisFileDirectory)Features</CratisProxiesOutputPath>
  <CratisProxiesSegmentsToSkip>1</CratisProxiesSegmentsToSkip>
  <CratisProxiesSkipOutputDeletion>true</CratisProxiesSkipOutputDeletion>
  <CratisProxiesSkipCommandNameInRoute>true</CratisProxiesSkipCommandNameInRoute>
  <CratisProxiesSkipQueryNameInRoute>false</CratisProxiesSkipQueryNameInRoute>
  <CratisProxiesApiPrefix>api</CratisProxiesApiPrefix>
  <CratisProxiesSkipFileIndexTracking>false</CratisProxiesSkipFileIndexTracking>
  <CratisProxiesSkipIndexGeneration>false</CratisProxiesSkipIndexGeneration>
</PropertyGroup>
```

### What each setting does

- `CratisProxiesOutputPath`: Output directory for generated proxies.
- `CratisProxiesSegmentsToSkip`: Skips namespace segments when creating folder paths.
- `CratisProxiesSkipOutputDeletion`: When `false` (default), output folder is deleted on each build; set `true` for incremental generation.
- `CratisProxiesSkipCommandNameInRoute`: Excludes command names from generated routes when possible.
- `CratisProxiesSkipQueryNameInRoute`: Excludes query names from generated routes when possible.
- `CratisProxiesApiPrefix`: API prefix used in generated routes (default `api`).
- `CratisProxiesSkipFileIndexTracking`: Disables orphan-file tracking when `true`.
- `CratisProxiesSkipIndexGeneration`: Disables `index.ts` generation when `true`.

### Automatic routes and proxy generation

Arc automatically maps model-bound commands and queries to HTTP routes based on namespace conventions.

Keep runtime (`appsettings.json`) and proxy generation (`.csproj`) settings aligned:

- `Cratis:Arc:GeneratedApis:RoutePrefix` <-> `CratisProxiesApiPrefix`
- `Cratis:Arc:GeneratedApis:SegmentsToSkipForRoute` <-> `CratisProxiesSegmentsToSkip`
- `Cratis:Arc:GeneratedApis:IncludeCommandNameInRoute` <-> inverse of `CratisProxiesSkipCommandNameInRoute`
- `Cratis:Arc:GeneratedApis:IncludeQueryNameInRoute` <-> inverse of `CratisProxiesSkipQueryNameInRoute`

If these are out of sync, generated TypeScript proxies can call routes that do not match mapped backend endpoints.

In this template, both segment-skip settings are set to `1`:

```json
{
  "Cratis": {
    "Arc": {
      "GeneratedApis": {
        "RoutePrefix": "api",
        "IncludeCommandNameInRoute": false,
        "SegmentsToSkipForRoute": 1
      }
    }
  }
}
```

```xml
<PropertyGroup>
  <CratisProxiesSegmentsToSkip>1</CratisProxiesSegmentsToSkip>
  <CratisProxiesSkipCommandNameInRoute>true</CratisProxiesSkipCommandNameInRoute>
</PropertyGroup>
```

`IncludeQueryNameInRoute` is not explicitly set in this template, so the Arc default (`true`) applies. This matches proxy generation default `CratisProxiesSkipQueryNameInRoute=false`.

When command/query names are excluded, both runtime mapping and proxy generation automatically re-include names when needed to avoid route collisions.

### Verify generation

Run:

```bash
dotnet build
```

Then inspect your configured `CratisProxiesOutputPath` directory for generated proxies.

## Learn More

- [Cratis Arc Documentation](https://www.cratis.io/docs/Arc/)
- [Cratis Arc ASP.NET Core Configuration](https://www.cratis.io/docs/Arc/backend/asp-net-core/configuration.html)
- [Cratis Arc Proxy Generation Configuration](https://www.cratis.io/docs/Arc/backend/proxy-generation/index.html)
- [Cratis Arc Model Bound Commands](https://www.cratis.io/docs/Arc/backend/commands/model-bound/index.html)
- [Cratis Arc Model Bound Queries](https://www.cratis.io/docs/Arc/backend/queries/model-bound/index.html)
- [Chronicle Documentation](https://www.cratis.io/docs/Chronicle/)
