@live
Feature: A thin check against the real Open-Meteo service

  Everything else in this suite runs against a test double, which is what
  makes the weather scenarios deterministic. That leaves one risk uncovered:
  the double could drift from the real Open-Meteo payloads and every test
  would still pass.

  These scenarios close that gap. They assert the contract and nothing about
  the catalogue: not a population, not a region spelling, not a place name.
  Open-Meteo calls Chamonix "Chamonix" in "Rhône-Alpes" today and may well
  restate that tomorrow, and a drift check that breaks when a region gets
  renamed is a drift check nobody reruns. Run them on a schedule rather than
  on every commit: `npm run test:live`.

  Background:
    Given the Activity Ranking API is available

  # "London" rather than a name that returns one match: distinctness is a rule
  # about telling several places apart, and a single-result query satisfies it
  # without ever comparing anything.
  #
  # It is also the query that first broke the rule. The real catalogue holds
  # two distinct towns that both label as "London, Alabama, United States",
  # which is what forced a colliding label to reach for the county.
  @smoke
  Scenario: A real search returns places a picker can tell apart
    When I search for locations matching "London"
    Then the response status is 200
    And the response matches the locations contract
    And the search returns at least 3 results
    And every result has a distinct display name

  Scenario: A real forecast still fits the contract
    Also the seam: an id taken from a search result has to be one the ranking
    endpoint accepts, which is the single most-used path in the product.

    When I search for locations matching "Chamonix"
    And I request rankings for the first search result
    Then the response status is 200
    And the response matches the rankings contract
    And every day ranks all four activities:
      | SKIING              |
      | SURFING             |
      | OUTDOOR_SIGHTSEEING |
      | INDOOR_SIGHTSEEING  |
    And every rating matches the documented band for its score
    And every day numbers its activities 1 to 4 with no gaps or duplicates
    And every reasoning gives a reason the user can act on
    And every reasoning is at most 160 characters

  Scenario: The real service still disambiguates London
    When I request rankings for the city "London"
    Then the response status is 409
    And the error code is "AMBIGUOUS_LOCATION"
    And the error details list the candidate locations
