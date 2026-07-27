var builder = WebApplication.CreateBuilder(args);
builder.AddCratis(
    configureChronicleBuilder: chronicleBuilder => chronicleBuilder.WithCamelCaseNamingPolicy(),
    configureArcBuilder: arcBuilder => arcBuilder.WithMongoDB(configureMongoDB: builder => builder.WithCamelCaseNamingPolicy()));
    
builder.Services.AddControllers();
builder.Services.AddMvc();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options => options.AddConcepts());

var app = builder.Build();

app.UseRouting();

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseWebSockets();
app.MapControllers();
app.UseCratis();
 
app.UseSwagger();
app.UseSwaggerUI();
app.MapFallbackToFile("/index.html");

await app.RunAsync();
