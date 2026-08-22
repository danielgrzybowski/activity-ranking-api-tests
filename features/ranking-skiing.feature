@rankings @scoring
Feature: Ranking skiing conditions

  Skiing asks two questions of a day, in this order: is there a ski area here
  at all, and does the weather suit it. Snow falls on plenty of places with no
  lift, no piste and no ski patrol, and a forecast is not a reason to tell
  someone in Cornwall the skiing is good.

  Where there is a ski area, skiing needs snow, air cold enough to keep it,
  and wind the lifts can run in. The weather days below are deliberately
  unambiguous: a skier reading the numbers would give the same verdict the
  scenarios ask for. Where a scenario allows a range of ratings it is because
  the exact number is the implementation's business - the verdict a user reads
  is not.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities

  @smoke
  Scenario: Fresh powder with light wind is a top skiing day
    Given day 1 of the forecast for "Chamonix" is "ALPINE_POWDER_DAY"
    When I request rankings for location id "3027301"
    Then on day 1 "SKIING" is rated "EXCELLENT"
    And on day 1 "SKIING" is ranked 1
    And on day 1 the reasoning for "SKIING" mentions one of "snow, snowfall, powder"
    And "SKIING" is scored on the weather, not ruled out by the location

  # Same forecast as the scenario above; only the location moves.
  Scenario: A town with no ski area never offers skiing, however much snow falls
    25cm of snow on a Cornish surf town is a news story, not a ski holiday.

    Given every day of the forecast for "Bude" is "ALPINE_POWDER_DAY"
    When I request rankings for location id "2654380"
    Then the response status is 200
    And "SKIING" is reported as not possible at this location
    And on day 1 the reasoning for "SKIING" mentions one of "ski area, inland"

  Scenario: A blizzard is not a skiing day, however much snow falls
    40cm of fresh snow is worthless if the lifts are on a wind hold.

    Given day 1 of the forecast for "Chamonix" is "BLIZZARD"
    When I request rankings for location id "3027301"
    Then on day 1 "SKIING" is rated no better than "FAIR"
    And on day 1 the reasoning for "SKIING" mentions one of "wind, gust"

  Scenario Outline: Skiing verdicts across representative days
    Given day 1 of the forecast for "Chamonix" is "<profile>"
    When I request rankings for location id "3027301"
    Then on day 1 "SKIING" is rated between "<lowest>" and "<highest>"

    Examples:
      | profile            | lowest     | highest    |
      | ALPINE_POWDER_DAY  | EXCELLENT  | EXCELLENT  |
      | LIGHT_SNOW_DAY     | GOOD       | EXCELLENT  |
      | COLD_DRY_DAY       | UNSUITABLE | FAIR       |
      | BLIZZARD           | UNSUITABLE | FAIR       |
      | SPRING_SLUSH_DAY   | UNSUITABLE | POOR       |
      | COLD_RAIN_DAY      | UNSUITABLE | POOR       |
      | PERFECT_SUMMER_DAY | UNSUITABLE | UNSUITABLE |

  # The three days differ in snowfall (25cm, 6cm, none) and in nothing else
  # that matters: all three sit at -3 to -4C with light wind. An earlier
  # version of this scenario compared a powder day with a mild day and a
  # summer day, which it passed by reading the temperature - the one thing it
  # was not testing.
  Scenario: More snow never scores worse than less snow
    More snow, all else equal, should never rank lower - a ranking that is not
    monotonic in its main driver is not explainable to a user.

    Given day 1 of the forecast for "Chamonix" is "ALPINE_POWDER_DAY"
    And day 2 of the forecast for "Chamonix" is "LIGHT_SNOW_DAY"
    And day 3 of the forecast for "Chamonix" is "COLD_DRY_DAY"
    When I request rankings for location id "3027301"
    Then "SKIING" scores higher on day 1 than on day 2
    And "SKIING" scores higher on day 2 than on day 3
