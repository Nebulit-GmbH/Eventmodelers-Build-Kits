using CratisApp.SomeModule.SomeFeature.Registration;

namespace CratisApp.SomeModule.SomeFeature.Listing;

[ReadModel]
[FromEvent<Registered>]
public record Listing(Guid Id, SomeName Name, EventSourceId EventSourceId)
{
    public static ISubject<IEnumerable<Listing>> AllListings(IMongoCollection<Listing> collection) =>
        collection.Observe();
}
