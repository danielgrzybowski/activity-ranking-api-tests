@live
Feature: A thin check against the real Open-Meteo service

  Everything else in this suite runs against a test double, which is what
  makes the weather scenarios deterministic. That leaves one risk uncovered:
  the double could drift from the real Open-Meteo payloads and every test
  would still pass.

  These scenarios close that gap. They assert only what is true whatever the
  weather is, so they never flake on a forecast. Run them on a schedule
  rather than on every commit: `npm run test:live`.

  Background:
    Given the Activity Ranking API is available

  @smoke
  Scenario: A real city can still be found
    When I search for locations matching "Chamonix"
    Then the response status is 200
    And the response matches the locations contract
    And the search results include "Chamonix-Mont-Blanc, Auvergne-Rhone-Alpes, France"

  Scenario: A real forecast still fits the contract
    When I request rankings for the city "Chamonix-Mont-Blanc"
    Then the response status is 200
    And the response matches the rankings contract
    And every day ranks all four activities:
      | SKIING              |
      | SURFING             |
      | OUTDOOR_SIGHTSEEING |
      | INDOOR_SIGHTSEEING  |
    And every rating matches the documented band for its score
    And every day numbers its activities 1 to 4 with no gaps or duplicates
    And every reasoning refers to at least one weather driver
    And every reasoning is at most 160 characters

  Scenario: The real service still disambiguates London
    When I request rankings for the city "London"
    Then the response status is 409
    And the error code is "AMBIGUOUS_LOCATION"
    And the error details list the candidate locations
