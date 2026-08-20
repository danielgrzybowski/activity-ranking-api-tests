@rankings @scoring
Feature: Ranking surfing conditions

  Surfing is scored from wind and air temperature, which stand in for swell
  in this contract - see the trade-offs section of the README. The shape of
  the judgement is a middle band: too little wind and there is nothing to
  ride, too much and it is dangerous.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities

  @smoke
  Scenario: A mild day with a steady breeze is a top surfing day
    Given day 1 of the forecast for "Bude" is a "CLEAN_SWELL_DAY"
    When I request rankings for location id "2654675"
    Then on day 1 "SURFING" is rated "EXCELLENT"
    And on day 1 "SURFING" is ranked 1
    And on day 1 the reasoning for "SURFING" mentions one of "wind, breeze, swell"

  Scenario: A flat calm day is warm and pleasant but not surfable
    Given day 1 of the forecast for "Bude" is a "FLAT_CALM_DAY"
    When I request rankings for location id "2654675"
    Then on day 1 "SURFING" is rated no better than "POOR"
    And on day 1 the reasoning for "SURFING" mentions one of "wind, calm, flat, swell"
    And on day 1 "OUTDOOR_SIGHTSEEING" is ranked above "SURFING"

  Scenario: A storm is dangerous rather than exciting
    Given day 1 of the forecast for "Bude" is a "STORM_DAY"
    When I request rankings for location id "2654675"
    Then on day 1 "SURFING" is rated "UNSUITABLE"
    And on day 1 the reasoning for "SURFING" mentions one of "wind, gust, storm, unsafe, dangerous"

  Scenario: Freezing air rules surfing out regardless of the wind
    Given day 1 of the forecast for "Bude" is a "ALPINE_POWDER_DAY"
    When I request rankings for location id "2654675"
    Then on day 1 "SURFING" is rated no better than "POOR"
    And on day 1 the reasoning for "SURFING" mentions one of "cold, temperature, °c, freezing"

  # Too little wind and too much wind must both lose to the middle.
  Scenario: Surfing peaks in the middle of the wind range
    Given day 1 of the forecast for "Bude" is a "FLAT_CALM_DAY"
    And day 2 of the forecast for "Bude" is a "CLEAN_SWELL_DAY"
    And day 3 of the forecast for "Bude" is a "STORM_DAY"
    When I request rankings for location id "2654675"
    Then "SURFING" scores higher on day 2 than on day 1
    And "SURFING" scores higher on day 2 than on day 3

  Scenario Outline: Surfing verdicts across representative days
    Given day 1 of the forecast for "Bude" is a "<profile>"
    When I request rankings for location id "2654675"
    Then on day 1 "SURFING" is rated between "<lowest>" and "<highest>"

    Examples:
      | profile            | lowest     | highest    |
      | CLEAN_SWELL_DAY    | EXCELLENT  | EXCELLENT  |
      | MILD_OVERCAST_DAY  | POOR       | GOOD       |
      | FLAT_CALM_DAY      | UNSUITABLE | POOR       |
      | STORM_DAY          | UNSUITABLE | UNSUITABLE |
      | ALPINE_POWDER_DAY  | UNSUITABLE | POOR       |
      | COLD_RAIN_DAY      | UNSUITABLE | POOR       |
